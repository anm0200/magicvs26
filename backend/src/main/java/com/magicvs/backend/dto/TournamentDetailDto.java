package com.magicvs.backend.dto;

import com.magicvs.backend.model.TournamentStatus;

import java.time.LocalDateTime;
import java.util.List;

public record TournamentDetailDto(
    Long id,
    String name,
    String description,
    Integer maxPlayers,
    long participantCount,
    TournamentStatus status,
    LocalDateTime startDate,
    Long winnerUserId,
    Integer currentRound,
    boolean joinedByCurrentUser,
    List<TournamentParticipantDto> participants,
    List<TournamentMatchDto> matches
) {
}
