package com.magicvs.backend.controller;

import com.magicvs.backend.model.IngestionJobType;
import com.magicvs.backend.model.MetaDeck;
import com.magicvs.backend.repository.MetaDeckRepository;
import com.magicvs.backend.service.IngestionJobProducer;
import java.util.Map;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Profile;
import org.springframework.http.HttpStatus;
import org.springframework.data.domain.Sort;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/meta")
@org.springframework.web.bind.annotation.CrossOrigin(origins = "http://localhost:4200")
@Profile("backend")
public class MetaController {

    @Autowired
    private MetaDeckRepository metaDeckRepository;

    @Autowired
    private IngestionJobProducer ingestionJobProducer;

    @GetMapping
    public List<MetaDeck> getMetagame() {
        return metaDeckRepository.findAll(Sort.by(Sort.Direction.ASC, "tier"));
    }

    @PostMapping("/sync")
    public ResponseEntity<Map<String, Object>> forceSync(@RequestParam(defaultValue = "30") String days) {
        UUID jobId = ingestionJobProducer.enqueue(IngestionJobType.META_SYNC, Map.of("days", days));
        return ResponseEntity.status(HttpStatus.ACCEPTED).body(Map.of(
                "message", "Sincronización de metajuego encolada",
                "jobId", jobId));
    }
}
