package com.magicvs.backend.config;

import com.magicvs.backend.model.IngestionJobType;
import com.magicvs.backend.repository.CardRepository;
import com.magicvs.backend.repository.MetaDeckRepository;
import com.magicvs.backend.repository.NewsRepository;
import com.magicvs.backend.service.IngestionJobProducer;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.CommandLineRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

@Component
@Profile("backend")
@ConditionalOnProperty(name = "ingestion.initializer.enabled", havingValue = "true", matchIfMissing = true)
public class DatabaseInitializer implements CommandLineRunner {

    private static final Logger logger = LoggerFactory.getLogger(DatabaseInitializer.class);

    private final CardRepository cardRepository;
    private final MetaDeckRepository metaDeckRepository;
    private final NewsRepository newsRepository;
    private final IngestionJobProducer ingestionJobProducer;

    public DatabaseInitializer(
            CardRepository cardRepository,
            MetaDeckRepository metaDeckRepository,
            NewsRepository newsRepository,
            IngestionJobProducer ingestionJobProducer) {
        this.cardRepository = cardRepository;
        this.metaDeckRepository = metaDeckRepository;
        this.newsRepository = newsRepository;
        this.ingestionJobProducer = ingestionJobProducer;
    }

    @Override
    public void run(String... args) {
        if (cardRepository.count() == 0) {
            logger.info("Base de datos de cartas vacía. Encolando importación automática de Standard...");
            ingestionJobProducer.enqueue(IngestionJobType.CARD_IMPORT_STANDARD, Map.of());
        } else {
            logger.info("Base de datos de cartas ya poblada con {} registros. Omitiendo importación inicial.",
                    cardRepository.count());
        }

        if (metaDeckRepository.count() == 0) {
            logger.info("Base de datos de Metajuego vacía. Encolando sincronización inicial de MTGGoldfish...");
            ingestionJobProducer.enqueue(IngestionJobType.META_SYNC, Map.of("days", "30"));
        } else {
            logger.info("Metajuego ya inicializado con {} mazos. Esperando al proceso programado para actualizar.",
                    metaDeckRepository.count());
        }

        if (newsRepository.count() == 0) {
            logger.info("Base de datos de noticias vacía. Encolando sincronización inicial de noticias...");
            ingestionJobProducer.enqueue(IngestionJobType.NEWS_SYNC, Map.of());
        } else {
            logger.info("Noticias ya inicializadas con {} registros. Omitiendo sincronización inicial.",
                    newsRepository.count());
        }
    }
}
