package com.magicvs.backend.config;

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
    private static final String CONSTRAINT_NAME = "notifications_type_check";

    private final JdbcTemplate jdbcTemplate;

    public NotificationSchemaInitializer(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void synchronizeNotificationTypeConstraint() {
        try {
            String allowedTypes = Arrays.stream(NotificationType.values())
                    .map(Enum::name)
                    .map(value -> "'" + value.replace("'", "''") + "'")
                    .collect(Collectors.joining(", "));

            jdbcTemplate.execute("ALTER TABLE notifications DROP CONSTRAINT IF EXISTS " + CONSTRAINT_NAME);
            jdbcTemplate.execute("ALTER TABLE notifications ADD CONSTRAINT " + CONSTRAINT_NAME
                    + " CHECK (type IN (" + allowedTypes + "))");

            logger.info("Synchronized notifications type constraint with {} values", NotificationType.values().length);
        } catch (Exception ex) {
            logger.warn("Could not synchronize notifications type constraint: {}", ex.getMessage());
        }
    }
}
