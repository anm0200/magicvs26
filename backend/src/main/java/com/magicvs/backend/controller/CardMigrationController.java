package com.magicvs.backend.controller;
import com.magicvs.backend.model.AppliedMigration;
import com.magicvs.backend.service.ScryfallMigrationService;
import com.magicvs.backend.repository.AppliedMigrationRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/cards/migrations")
public class CardMigrationController {

    @Autowired
    private ScryfallMigrationService scryfallMigrationService;

    @Autowired
    private AppliedMigrationRepository appliedMigrationRepository;

    /**
     * Ejecuta manualmente la aplicación de migraciones de Scryfall pendientes.
     */
    @PostMapping("/apply")
    public ResponseEntity<Map<String, Object>> applyMigrations() {
        long startTime = System.currentTimeMillis();
        int count = scryfallMigrationService.applyMigrations();
        long duration = System.currentTimeMillis() - startTime;

        Map<String, Object> response = new HashMap<>();
        response.put("message", "Proceso de migración completado");
        response.put("appliedCount", count);
        response.put("durationMs", duration);
        return ResponseEntity.ok(response);
    }

    /**
     * Devuelve el historial de migraciones aplicadas localmente.
     */
    @GetMapping("/history")
    public ResponseEntity<List<AppliedMigration>> getMigrationHistory() {
        List<AppliedMigration> history = appliedMigrationRepository.findAll();
        // Ordenar por fecha de aplicación descendente
        history.sort((a, b) -> b.getAppliedAt().compareTo(a.getAppliedAt()));
        return ResponseEntity.ok(history);
    }
}
