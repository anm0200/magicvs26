package com.magicvs.backend.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Profile;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
@Profile("worker")
public class ScryfallScheduler {
    
    private static final Logger log = LoggerFactory.getLogger(ScryfallScheduler.class);
    
    private final ScryfallMigrationService scryfallMigrationService;
    private final ScryfallService scryfallService;

    public ScryfallScheduler(ScryfallMigrationService scryfallMigrationService, ScryfallService scryfallService) {
        this.scryfallMigrationService = scryfallMigrationService;
        this.scryfallService = scryfallService;
    }

    /**
     * Tarea programada diaria a las 3:00 AM para aplicar migraciones y luego sincronizar cartas Standard.
     */
    @Scheduled(cron = "0 0 3 * * ?")
    public void runDailySyncAndMigrations() {
        log.info("Iniciando sincronización diaria de cartas y aplicación de migraciones de Scryfall...");
        try {
            int migrationsCount = scryfallMigrationService.applyMigrations();
            log.info("Se aplicaron {} migraciones de Scryfall.", migrationsCount);
        } catch (Exception e) {
            log.error("Error durante la aplicación programada de migraciones", e);
        }

        try {
            log.info("Iniciando actualización de cartas Standard...");
            int standardCount = scryfallService.importStandardCards();
            log.info("Actualizadas/Importadas {} cartas Standard.", standardCount);
        } catch (Exception e) {
            log.error("Error durante la importación automática diaria de cartas Standard", e);
        }
    }
}
