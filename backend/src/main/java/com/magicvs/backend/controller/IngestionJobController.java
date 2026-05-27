package com.magicvs.backend.controller;

import com.magicvs.backend.model.IngestionJob;
import com.magicvs.backend.repository.IngestionJobRepository;
import java.util.UUID;
import org.springframework.context.annotation.Profile;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/ingestion/jobs")
@Profile("backend")
public class IngestionJobController {

    private final IngestionJobRepository ingestionJobRepository;

    public IngestionJobController(IngestionJobRepository ingestionJobRepository) {
        this.ingestionJobRepository = ingestionJobRepository;
    }

    @GetMapping("/{jobId}")
    public ResponseEntity<IngestionJob> getJob(@PathVariable UUID jobId) {
        return ingestionJobRepository.findById(jobId)
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.notFound().build());
    }
}
