package com.magicvs.backend.controller;

import com.magicvs.backend.dto.ReportMatchRequest;
import com.magicvs.backend.dto.TournamentMatchDto;
import com.magicvs.backend.service.AuthService;
import com.magicvs.backend.service.TournamentService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import static org.springframework.http.HttpStatus.UNAUTHORIZED;

@RestController
@CrossOrigin(origins = "http://localhost:4200")
@RequestMapping("/api/matches")
public class MatchController {

    private final TournamentService tournamentService;
    private final AuthService authService;

    public MatchController(TournamentService tournamentService, AuthService authService) {
        this.tournamentService = tournamentService;
        this.authService = authService;
    }

    @PostMapping("/{id}/report")
    public ResponseEntity<TournamentMatchDto> reportMatch(
        @PathVariable Long id,
        @RequestHeader(value = "Authorization", required = false) String authorization,
        @RequestBody ReportMatchRequest request
    ) {
        Long reporterId = requireAuthenticatedUser(authorization);
        TournamentMatchDto updated = tournamentService.reportMatchResult(id, reporterId, request.getWinnerId());
        return ResponseEntity.ok(updated);
    }

    private Long requireAuthenticatedUser(String authorization) {
        if (authorization == null || !authorization.startsWith("Bearer ")) {
            throw new ResponseStatusException(UNAUTHORIZED, "Token no proporcionado");
        }

        String token = authorization.substring("Bearer ".length());
        return authService.getUserId(token)
            .orElseThrow(() -> new ResponseStatusException(UNAUTHORIZED, "Token inválido"));
    }
}
