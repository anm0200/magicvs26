package com.magicvs.backend.config;

import com.magicvs.backend.model.IngestionJobStatus;
import com.magicvs.backend.model.IngestionJobType;
import com.magicvs.backend.model.NotificationType;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.annotation.Profile;
import org.springframework.context.event.EventListener;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.util.Arrays;
import java.util.stream.Collectors;

@Component
@Profile("backend")
public class NotificationSchemaInitializer {

    private static final Logger logger = LoggerFactory.getLogger(NotificationSchemaInitializer.class);
    private final JdbcTemplate jdbcTemplate;

    public NotificationSchemaInitializer(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void synchronizeNotificationTypeConstraint() {
        synchronizeEnumConstraint("notifications", "type", "notifications_type_check", NotificationType.values());
        synchronizeEnumConstraint("ingestion_jobs", "type", "ingestion_jobs_type_check", IngestionJobType.values());
        synchronizeEnumConstraint("ingestion_jobs", "status", "ingestion_jobs_status_check", IngestionJobStatus.values());
    }

    private void synchronizeEnumConstraint(String table, String column, String constraintName, Enum<?>[] values) {
        try {
            String allowedValues = Arrays.stream(values)
                    .map(Enum::name)
                    .map(value -> "'" + value.replace("'", "''") + "'")
                    .collect(Collectors.joining(", "));

            jdbcTemplate.execute("ALTER TABLE " + table + " DROP CONSTRAINT IF EXISTS " + constraintName);
            jdbcTemplate.execute("ALTER TABLE " + table + " ADD CONSTRAINT " + constraintName
                    + " CHECK (" + column + " IN (" + allowedValues + "))");

            logger.info("Synchronized {}.{} constraint with {} values", table, column, values.length);
        } catch (Exception ex) {
            logger.warn("Could not synchronize {}.{} constraint: {}", table, column, ex.getMessage());
        }
    }
}
