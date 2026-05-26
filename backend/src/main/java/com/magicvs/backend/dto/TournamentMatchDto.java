package com.magicvs.backend.dto;

import com.magicvs.backend.model.MatchStatus;

public record TournamentMatchDto(
    Long id,
    Integer roundNumber,
    Integer matchNumber,
    Long player1Id,
    Long player2Id,
    Long winnerId,
    Long battleMatchId,
    Boolean player1Accepted,
    Boolean player2Accepted,
    MatchStatus status
) {
}
