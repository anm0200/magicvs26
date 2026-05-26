package com.magicvs.backend.service;

import com.magicvs.backend.model.IngestionJob;
import com.magicvs.backend.model.IngestionJobStatus;
import com.magicvs.backend.model.IngestionJobType;
import com.magicvs.backend.repository.IngestionJobRepository;
import jakarta.annotation.PostConstruct;
import java.time.Duration;
import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Profile;
import org.springframework.data.redis.connection.stream.Consumer;
import org.springframework.data.redis.connection.stream.MapRecord;
import org.springframework.data.redis.connection.stream.ReadOffset;
import org.springframework.data.redis.connection.stream.StreamOffset;
import org.springframework.data.redis.connection.stream.StreamReadOptions;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
@Profile("worker")
public class IngestionWorker {

    private static final Logger log = LoggerFactory.getLogger(IngestionWorker.class);
    private static final long[] BACKOFF_SECONDS = {30, 60, 120, 240, 480};

    private final IngestionJobRepository ingestionJobRepository;
    private final IngestionJobDispatcher dispatcher;
    private final StringRedisTemplate redisTemplate;
    private final String streamKey;
    private final String consumerGroup;
    private final String consumerName;
    private final String dlqStreamKey;

    public IngestionWorker(
            IngestionJobRepository ingestionJobRepository,
            IngestionJobDispatcher dispatcher,
            StringRedisTemplate redisTemplate,
            @Value("${ingestion.stream}") String streamKey,
            @Value("${ingestion.consumer-group}") String consumerGroup,
            @Value("${ingestion.consumer-name}") String consumerName,
            @Value("${ingestion.dlq-stream}") String dlqStreamKey) {
        this.ingestionJobRepository = ingestionJobRepository;
        this.dispatcher = dispatcher;
        this.redisTemplate = redisTemplate;
        this.streamKey = streamKey;
        this.consumerGroup = consumerGroup;
        this.consumerName = consumerName;
        this.dlqStreamKey = dlqStreamKey;
    }

    @PostConstruct
    public void initializeConsumerGroup() {
        try {
            if (Boolean.FALSE.equals(redisTemplate.hasKey(streamKey))) {
                redisTemplate.opsForStream().add(streamKey, Map.of("init", "true"));
            }
            redisTemplate.opsForStream().createGroup(streamKey, ReadOffset.from("0-0"), consumerGroup);
            log.info("Redis stream consumer group created stream={} group={}", streamKey, consumerGroup);
        } catch (Exception e) {
            if (!isBusyGroupError(e)) {
                throw e;
            }
            log.info("Redis stream consumer group already exists stream={} group={}", streamKey, consumerGroup);
        }
    }

    @Scheduled(fixedDelayString = "${ingestion.poll-delay-ms:1000}")
    public void poll() {
        List<MapRecord<String, Object, Object>> records = redisTemplate.opsForStream().read(
                Consumer.from(consumerGroup, consumerName),
                StreamReadOptions.empty().count(10).block(Duration.ofMillis(500)),
                StreamOffset.create(streamKey, ReadOffset.lastConsumed()));

        if (records == null || records.isEmpty()) {
            return;
        }

        for (MapRecord<String, Object, Object> record : records) {
            process(record);
        }
    }

    @Scheduled(fixedDelayString = "${ingestion.retry-scheduler-delay-ms:5000}")
    public void republishDueRetries() {
        List<IngestionJob> dueJobs = ingestionJobRepository
                .findTop20ByStatusAndNextAttemptAtLessThanEqualOrderByNextAttemptAtAsc(
                        IngestionJobStatus.RETRY_SCHEDULED,
                        LocalDateTime.now());

        for (IngestionJob job : dueJobs) {
            job.setStatus(IngestionJobStatus.PENDING);
            job.setNextAttemptAt(null);
            ingestionJobRepository.save(job);
            publish(job);
            log.info("Republished ingestion job jobId={} jobType={} attempt={} status={}",
                    job.getJobId(), job.getType(), job.getAttempt(), job.getStatus());
        }
    }

    private void process(MapRecord<String, Object, Object> record) {
        Map<Object, Object> message = record.getValue();
        String jobIdValue = value(message, "jobId");
        String typeValue = value(message, "type");
        String payloadJson = value(message, "payload");

        if (jobIdValue == null || typeValue == null) {
            acknowledge(record);
            return;
        }

        UUID jobId = UUID.fromString(jobIdValue);
        IngestionJobType type = IngestionJobType.valueOf(typeValue);
        Optional<IngestionJob> maybeJob = ingestionJobRepository.findById(jobId);
        if (maybeJob.isEmpty()) {
            acknowledge(record);
            return;
        }

        IngestionJob job = maybeJob.get();
        if (job.getStatus() == IngestionJobStatus.SUCCEEDED || job.getStatus() == IngestionJobStatus.FAILED) {
            acknowledge(record);
            return;
        }

        long start = System.currentTimeMillis();
        MDC.put("jobId", jobId.toString());
        MDC.put("jobType", type.name());
        try {
            markRunning(job);
            dispatcher.dispatch(type, payloadJson);
            markSucceeded(job);
            long durationMs = System.currentTimeMillis() - start;
            log.info("Ingestion job completed jobId={} jobType={} attempt={} status={} durationMs={}",
                    jobId, type, job.getAttempt(), job.getStatus(), durationMs);
        } catch (Exception e) {
            handleFailure(job, type, payloadJson, e, System.currentTimeMillis() - start);
        } finally {
            MDC.clear();
            acknowledge(record);
        }
    }

    private void markRunning(IngestionJob job) {
        job.setStatus(IngestionJobStatus.RUNNING);
        job.setAttempt(job.getAttempt() + 1);
        job.setStartedAt(LocalDateTime.now());
        job.setLastError(null);
        ingestionJobRepository.save(job);
    }

    private void markSucceeded(IngestionJob job) {
        job.setStatus(IngestionJobStatus.SUCCEEDED);
        job.setFinishedAt(LocalDateTime.now());
        job.setNextAttemptAt(null);
        ingestionJobRepository.save(job);
    }

    private void handleFailure(
            IngestionJob job,
            IngestionJobType type,
            String payloadJson,
            Exception error,
            long durationMs) {
        String errorMessage = rootMessage(error);
        job.setLastError(errorMessage);

        if (job.getAttempt() < job.getMaxAttempts()) {
            job.setStatus(IngestionJobStatus.RETRY_SCHEDULED);
            job.setNextAttemptAt(LocalDateTime.now().plus(backoff(job.getAttempt())));
            ingestionJobRepository.save(job);
            log.warn("Ingestion job retry scheduled jobId={} jobType={} attempt={} status={} durationMs={} error={}",
                    job.getJobId(), type, job.getAttempt(), job.getStatus(), durationMs, errorMessage, error);
            return;
        }

        job.setStatus(IngestionJobStatus.FAILED);
        job.setFinishedAt(LocalDateTime.now());
        job.setNextAttemptAt(null);
        ingestionJobRepository.save(job);
        publishToDlq(job, type, payloadJson, errorMessage);
        log.error("Ingestion job failed jobId={} jobType={} attempt={} status={} durationMs={} error={}",
                job.getJobId(), type, job.getAttempt(), job.getStatus(), durationMs, errorMessage, error);
    }

    private Duration backoff(int attempt) {
        int index = Math.max(0, Math.min(attempt - 1, BACKOFF_SECONDS.length - 1));
        return Duration.ofSeconds(BACKOFF_SECONDS[index]);
    }

    private void publish(IngestionJob job) {
        Map<String, String> event = new LinkedHashMap<>();
        event.put("jobId", job.getJobId().toString());
        event.put("type", job.getType().name());
        event.put("payload", job.getPayloadJson());
        redisTemplate.opsForStream().add(streamKey, event);
    }

    private void publishToDlq(IngestionJob job, IngestionJobType type, String payloadJson, String errorMessage) {
        Map<String, String> event = new LinkedHashMap<>();
        event.put("jobId", job.getJobId().toString());
        event.put("type", type.name());
        event.put("payload", payloadJson == null ? "{}" : payloadJson);
        event.put("error", errorMessage);
        event.put("attempt", String.valueOf(job.getAttempt()));
        redisTemplate.opsForStream().add(dlqStreamKey, event);
    }

    private void acknowledge(MapRecord<String, Object, Object> record) {
        redisTemplate.opsForStream().acknowledge(streamKey, consumerGroup, record.getId());
    }

    private String value(Map<Object, Object> message, String key) {
        Object value = message.get(key);
        return value == null ? null : value.toString();
    }

    private String rootMessage(Throwable error) {
        Throwable current = error;
        while (current.getCause() != null) {
            current = current.getCause();
        }
        return current.getMessage() == null ? current.getClass().getSimpleName() : current.getMessage();
    }

    private boolean isBusyGroupError(Throwable error) {
        Throwable current = error;
        while (current != null) {
            String message = current.getMessage();
            if (message != null && message.contains("BUSYGROUP")) {
                return true;
            }
            current = current.getCause();
        }
        return false;
    }
}
