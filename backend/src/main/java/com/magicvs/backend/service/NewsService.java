package com.magicvs.backend.service;

import com.magicvs.backend.dto.NewsDto;
import com.magicvs.backend.model.News;
import com.magicvs.backend.repository.NewsRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.List;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class NewsService {

    private final NewsRepository newsRepository;

    public LocalDateTime getLastUpdateDate() {
        return newsRepository.findAll().stream()
                .map(News::getPublishDate)
                .max(LocalDateTime::compareTo)
                .orElse(LocalDateTime.now());
    }

    public List<NewsDto> getAllNews() {
        return newsRepository.findAll().stream()
                .map(this::convertToDto)
                .sorted((a, b) -> b.getPublishDate().compareTo(a.getPublishDate()))
                .collect(Collectors.toList());
    }

    private NewsDto convertToDto(News news) {
        return NewsDto.builder()
                .id(news.getId())
                .title(news.getTitle())
                .summary(news.getSummary())
                .url(news.getUrl())
                .imageUrl(news.getImageUrl())
                .publishDate(news.getPublishDate())
                .build();
    }
}
