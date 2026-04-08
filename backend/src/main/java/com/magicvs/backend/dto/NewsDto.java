package com.magicvs.backend.dto;

import lombok.*;
import java.time.LocalDateTime;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class NewsDto {
    private Long id;
    private String title;
    private String summary;
    private String url;
    private String imageUrl;
    private LocalDateTime publishDate;
}
