package com.magicvs.backend.service;

import com.magicvs.backend.model.News;
import lombok.extern.slf4j.Slf4j;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.jsoup.select.Elements;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.time.Year;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

@Service
@Slf4j
public class NewsScrapingService {

    private static final String MTG_GOLDFISH_URL = "https://www.mtggoldfish.com/articles";

    public List<News> scrapeNews() {
        List<News> newsList = new ArrayList<>();
        try {
            log.info("Starting scrape from {}", MTG_GOLDFISH_URL);
            Document doc = Jsoup.connect(MTG_GOLDFISH_URL)
                    .userAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
                    .get();
            Elements articles = doc.select(".article-tile");

            log.info("Found {} articles on MTGGoldfish", articles.size());

            for (Element article : articles) {
                try {
                    Element titleLink = article.selectFirst(".article-tile-title a");
                    if (titleLink == null) continue;

                    String title = titleLink.text();
                    String url = titleLink.absUrl("href");
                    String summary = article.select(".article-tile-abstract").text();
                    
                    // Improved image extraction targeting the img tag
                    Element img = article.selectFirst(".article-tile-image img");
                    String imageUrl = img != null ? img.absUrl("src") : "";

                    if (imageUrl.isEmpty()) {
                        // Fallback to background-image if necessary
                        String style = article.select(".article-tile-image").attr("style");
                        if (style.contains("url(")) {
                            imageUrl = style.substring(style.indexOf("url(") + 4, style.lastIndexOf(")"));
                            imageUrl = imageUrl.replaceAll("['\"]", "").trim();
                        }
                    }

                    // Extract and parse date
                    String dateStr = article.select(".article-tile-author strong").text();
                    LocalDateTime publishDate = parseDate(dateStr);

                    newsList.add(News.builder()
                            .title(title)
                            .url(url)
                            .summary(summary)
                            .imageUrl(imageUrl)
                            .publishDate(publishDate)
                            .build());
                } catch (Exception e) {
                    log.error("Error parsing article: {}", e.getMessage());
                }
            }
        } catch (Exception e) {
            log.error("Failed to scrape MTGGoldfish: {}", e.getMessage());
        }
        return newsList;
    }

    private LocalDateTime parseDate(String dateStr) {
        try {
            // MTGGoldfish format on articles page is "Apr 08"
            // We append the current year (2026) to make it a full date
            String dateWithYear = dateStr + ", " + Year.now().getValue();
            DateTimeFormatter formatter = DateTimeFormatter.ofPattern("MMM d, yyyy", Locale.ENGLISH);
            return LocalDateTime.parse(dateWithYear + " 00:00", 
                    DateTimeFormatter.ofPattern("MMM d, yyyy HH:mm", Locale.ENGLISH));
        } catch (Exception e) {
            log.warn("Could not parse date '{}', defaulting to now", dateStr);
            return LocalDateTime.now();
        }
    }
}
