package com.magicvs.backend.dto;

import com.magicvs.backend.model.TournamentStatus;

import java.time.LocalDateTime;

public record TournamentSummaryDto(
    Long id,
    String name,
    String description,
    Integer maxPlayers,
    long participantCount,
    TournamentStatus status,
    LocalDateTime startDate,
    Long winnerUserId
) {
}
