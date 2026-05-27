package com.magicvs.backend.dto;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.magicvs.backend.model.MatchStatus;

public record TournamentMatchAcceptanceDto(
    Long tournamentMatchId,
    Long battleMatchId,
    MatchStatus status,
    boolean ready,
    boolean battleMatchCreated,
    String link,
    @JsonIgnore Long deck1Id,
    @JsonIgnore Long deck2Id
) {
}
