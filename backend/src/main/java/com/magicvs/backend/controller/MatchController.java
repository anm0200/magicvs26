package com.magicvs.backend.controller;

import com.magicvs.backend.dto.MatchHistoryDto;
import com.magicvs.backend.dto.ReportMatchRequest;
import com.magicvs.backend.dto.TournamentMatchDto;
import com.magicvs.backend.service.AuthService;
import com.magicvs.backend.service.MatchService;
import com.magicvs.backend.service.TournamentService;
import java.util.List;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import static org.springframework.http.HttpStatus.UNAUTHORIZED;

@RestController
@CrossOrigin(origins = "http://localhost:4200")
@RequestMapping("/api/matches")
public class MatchController {

    private final TournamentService tournamentService;
    private final MatchService matchService;
    private final AuthService authService;

    public MatchController(
            TournamentService tournamentService,
            MatchService matchService,
            AuthService authService) {
        this.tournamentService = tournamentService;
        this.matchService = matchService;
        this.authService = authService;
    }

    @PostMapping("/{id}/report")
    public ResponseEntity<TournamentMatchDto> reportMatch(
            @PathVariable Long id,
            @RequestHeader(value = "Authorization", required = false) String authorization,
            @RequestBody ReportMatchRequest request) {
        Long reporterId = requireAuthenticatedUser(authorization);
        TournamentMatchDto updated = tournamentService.reportMatchResult(id, reporterId, request.getWinnerId());
        return ResponseEntity.ok(updated);
    }

    @GetMapping("/history")
    public ResponseEntity<List<MatchHistoryDto>> getHistory(
            @RequestHeader(value = "Authorization", required = false) String authorization) {
        Long userId = requireAuthenticatedUser(authorization);
        return ResponseEntity.ok(matchService.getHistoryForUser(userId));
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
