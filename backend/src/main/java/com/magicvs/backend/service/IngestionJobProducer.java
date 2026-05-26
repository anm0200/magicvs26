package com.magicvs.backend.service;

import com.magicvs.backend.model.IngestionJob;
import com.magicvs.backend.model.IngestionJobType;
import com.magicvs.backend.repository.IngestionJobRepository;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Profile;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import tools.jackson.databind.ObjectMapper;

@Service
@Profile("backend")
public class IngestionJobProducer {

    private final IngestionJobRepository ingestionJobRepository;
    private final StringRedisTemplate redisTemplate;
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final String streamKey;
    private final int maxAttempts;

    public IngestionJobProducer(
            IngestionJobRepository ingestionJobRepository,
            StringRedisTemplate redisTemplate,
            @Value("${ingestion.stream}") String streamKey,
            @Value("${ingestion.max-attempts}") int maxAttempts) {
        this.ingestionJobRepository = ingestionJobRepository;
        this.redisTemplate = redisTemplate;
        this.streamKey = streamKey;
        this.maxAttempts = maxAttempts;
    }

    @Transactional
    public UUID enqueue(IngestionJobType type, Map<String, Object> payload) {
        UUID jobId = UUID.randomUUID();
        String payloadJson = serialize(payload);
        ingestionJobRepository.save(IngestionJob.pending(jobId, type, payloadJson, maxAttempts));
        publishAfterCommit(jobId, type, payloadJson);
        return jobId;
    }

    private void publishAfterCommit(UUID jobId, IngestionJobType type, String payloadJson) {
        if (!TransactionSynchronizationManager.isSynchronizationActive()) {
            publish(jobId, type, payloadJson);
            return;
        }

        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                publish(jobId, type, payloadJson);
            }
        });
    }

    public void publish(UUID jobId, IngestionJobType type, String payloadJson) {
        Map<String, String> event = new LinkedHashMap<>();
        event.put("jobId", jobId.toString());
        event.put("type", type.name());
        event.put("payload", payloadJson);
        redisTemplate.opsForStream().add(streamKey, event);
    }

    private String serialize(Map<String, Object> payload) {
        try {
            return objectMapper.writeValueAsString(payload);
        } catch (Exception e) {
            throw new IllegalArgumentException("Could not serialize ingestion payload", e);
        }
    }
}
