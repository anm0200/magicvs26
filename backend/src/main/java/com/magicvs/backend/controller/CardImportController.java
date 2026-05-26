package com.magicvs.backend.controller;

import com.magicvs.backend.model.IngestionJobType;
import com.magicvs.backend.service.IngestionJobProducer;
import java.util.Map;
import java.util.UUID;
import org.springframework.context.annotation.Profile;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/cards/import")
@Profile("backend")
public class CardImportController {

    private final IngestionJobProducer ingestionJobProducer;

    public CardImportController(IngestionJobProducer ingestionJobProducer) {
        this.ingestionJobProducer = ingestionJobProducer;
    }

    /**
     * Importa todas las cartas legales en Standard.
     */
    @PostMapping("/standard")
    public ResponseEntity<Map<String, Object>> importStandard() {
        UUID jobId = ingestionJobProducer.enqueue(IngestionJobType.CARD_IMPORT_STANDARD, Map.of());
        return accepted("Importación de Standard encolada", jobId);
    }

    /**
     * Importa una carta por nombre.
     */
    @PostMapping("/name")
    public ResponseEntity<Map<String, Object>> importByName(
            @RequestParam String name,
            @RequestParam(defaultValue = "true") boolean onlyStandard) {
        UUID jobId = ingestionJobProducer.enqueue(
                IngestionJobType.CARD_IMPORT_BY_NAME,
                Map.of("name", name, "onlyStandard", onlyStandard));
        return accepted("Importación de carta encolada", jobId);
    }

    /**
     * Importa todas las cartas de un set.
     */
    @PostMapping("/set")
    public ResponseEntity<Map<String, Object>> importBySet(
            @RequestParam String code,
            @RequestParam(defaultValue = "true") boolean onlyStandard) {
        UUID jobId = ingestionJobProducer.enqueue(
                IngestionJobType.CARD_IMPORT_BY_SET,
                Map.of("code", code, "onlyStandard", onlyStandard));
        return accepted("Importación del set " + code + " encolada", jobId);
    }

    /**
     * Descarga o rellena las imágenes locales faltantes para las cartas ya importadas.
     */
    @PostMapping("/images")
    public ResponseEntity<Map<String, Object>> syncImages() {
        UUID jobId = ingestionJobProducer.enqueue(IngestionJobType.CARD_IMAGE_SYNC, Map.of());
        return accepted("Sincronización de imágenes locales encolada", jobId);
    }

    private ResponseEntity<Map<String, Object>> accepted(String message, UUID jobId) {
        return ResponseEntity.status(HttpStatus.ACCEPTED).body(Map.of(
                "message", message,
                "jobId", jobId));
    }
}
