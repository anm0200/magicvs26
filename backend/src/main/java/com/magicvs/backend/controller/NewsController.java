package com.magicvs.backend.controller;

import com.magicvs.backend.dto.NewsDto;
import com.magicvs.backend.model.IngestionJobType;
import com.magicvs.backend.model.User;
import com.magicvs.backend.repository.RegistroRepository;
import com.magicvs.backend.service.AchievementService;
import com.magicvs.backend.service.AuthService;
import com.magicvs.backend.service.IngestionJobProducer;
import com.magicvs.backend.service.NewsService;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Profile;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/news")
@RequiredArgsConstructor
@Profile("backend")
public class NewsController {

    private final NewsService newsService;
    private final IngestionJobProducer ingestionJobProducer;
    private final AuthService authService;
    private final RegistroRepository registroRepository;
    private final AchievementService achievementService;

    @GetMapping
    public List<NewsDto> getNews(@RequestHeader(name = "Authorization", required = false) String authorization) {
        if (authorization != null && authorization.startsWith("Bearer ")) {
            String token = authorization.substring("Bearer ".length());
            authService.getUserId(token)
                    .flatMap(registroRepository::findById)
                    .ifPresent(this::incrementNewsAchievements);
        }

        return newsService.getAllNews();
    }

    @GetMapping("/last-updated")
    public Map<String, LocalDateTime> getLastUpdated() {
        return Map.of("date", newsService.getLastUpdateDate());
    }

    @PostMapping("/scrape")
    public ResponseEntity<Map<String, Object>> manualScrape() {
        UUID jobId = ingestionJobProducer.enqueue(IngestionJobType.NEWS_SYNC, Map.of());
        return ResponseEntity.status(HttpStatus.ACCEPTED).body(Map.of(
                "message", "Sincronización de noticias encolada",
                "jobId", jobId));
    }

    private void incrementNewsAchievements(User user) {
        achievementService.increment(user, "NEWS_FIRST");
        achievementService.increment(user, "NEWS_10");
        achievementService.increment(user, "NEWS_50");
        achievementService.increment(user, "NEWS_200");
        achievementService.increment(user, "NEWS_1000");
    }
}
