package com.magicvs.backend.service;

import com.magicvs.backend.model.Card;
import com.magicvs.backend.repository.CardRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Async;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.InputStream;
import java.net.URL;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.util.List;
import java.util.UUID;

@Service
public class ImageDownloadService {

    private static final Logger logger = LoggerFactory.getLogger(ImageDownloadService.class);
    private final CardRepository cardRepository;
    private final Path cardsDirectory;

    public ImageDownloadService(
            CardRepository cardRepository,
            @Value("${cards.images.directory:/app/cards}") String cardsDirectory) {
        this.cardRepository = cardRepository;
        this.cardsDirectory = Paths.get(cardsDirectory);
    }

    @Async
    public void downloadMissingImagesAsync() {
        downloadMissingImages();
    }

    public void downloadMissingImages() {
        logger.info("Iniciando tarea de descarga de imágenes locales...");
        List<CardRepository.CardImageProjection> cards = cardRepository.findAllImageUris();
        
        try {
            if (!Files.exists(cardsDirectory)) {
                Files.createDirectories(cardsDirectory);
                logger.info("Directorio de imágenes creado con éxito: {}", cardsDirectory);
            }
        } catch (Exception e) {
            logger.error("No se pudo crear o acceder al directorio de imágenes: {}", cardsDirectory, e);
            return;
        }

        int downloaded = 0;
        int skipped = 0;
        int errors = 0;
        int processed = 0;

        for (CardRepository.CardImageProjection card : cards) {
            if (card.getScryfallId() == null) {
                continue;
            }

            String imageUrl = card.getNormalImageUri();
            if (imageUrl == null) {
                imageUrl = card.getFaceNormalImageUri();
            }

            if (imageUrl == null) {
                continue; // No hay imagen disponible
            }

            DownloadResult frontResult = downloadImage(card.getScryfallId(), "", imageUrl);
            downloaded += frontResult.downloaded();
            skipped += frontResult.skipped();
            errors += frontResult.errors();

            String backImageUrl = card.getBackFaceNormalImageUri();
            if (backImageUrl != null && !backImageUrl.isBlank() && !backImageUrl.equals(imageUrl)) {
                DownloadResult backResult = downloadImage(card.getScryfallId(), "-back", backImageUrl);
                downloaded += backResult.downloaded();
                skipped += backResult.skipped();
                errors += backResult.errors();
            }
            
            processed++;
            if (processed % 500 == 0) {
                logger.info("Progreso descarga imágenes: {} cartas procesadas de {} (Nuevas: {}, Omitidas: {}, Errores: {})",
                        processed, cards.size(), downloaded, skipped, errors);
            }
        }

        logger.info("Tarea de imágenes finalizada. Descargadas hoy: {}, Ya existían: {}, Errores: {}", downloaded, skipped, errors);
    }

    private DownloadResult downloadImage(UUID scryfallId, String suffix, String imageUrl) {
        String filename = scryfallId + suffix + ".jpg";
        Path imagePath = cardsDirectory.resolve(filename);

        if (Files.exists(imagePath)) {
            return new DownloadResult(0, 1, 0);
        }

        try {
            URL url = new URL(imageUrl);
            java.net.HttpURLConnection connection = (java.net.HttpURLConnection) url.openConnection();
            connection.setRequestProperty("User-Agent", "MagicVS/1.0");
            connection.setRequestProperty("Accept", "image/jpeg, image/png, image/*");

            try (InputStream in = connection.getInputStream()) {
                Files.copy(in, imagePath, StandardCopyOption.REPLACE_EXISTING);
            }

            // Retraso de 100ms para respetar la tasa de Scryfall (10 peticiones por segundo)
            Thread.sleep(100);
            return new DownloadResult(1, 0, 0);
        } catch (Exception e) {
            logger.error("Error descargando imagen para ID {}{}: {}", scryfallId, suffix, e.getMessage());
            try {
                Files.deleteIfExists(imagePath);
            } catch (Exception deleteError) {
                logger.warn("No se pudo limpiar la imagen incompleta {}: {}", imagePath, deleteError.getMessage());
            }
            return new DownloadResult(0, 0, 1);
        }
    }

    private record DownloadResult(int downloaded, int skipped, int errors) {}
}
