package com.magicvs.backend.dto;

import java.time.LocalDateTime;

public record TournamentParticipantDto(
    Long userId,
    String username,
    String displayName,
    Long deckId,
    String deckName,
    LocalDateTime joinedAt
) {
}
