package com.magicvs.backend.controller;

import com.magicvs.backend.dto.*;
import com.magicvs.backend.service.AuthService;
import com.magicvs.backend.service.TournamentService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;

@RestController
@CrossOrigin(origins = "http://localhost:4200")
@RequestMapping("/api/tournaments")
public class TournamentController {

    private final TournamentService tournamentService;
    private final AuthService authService;

    public TournamentController(TournamentService tournamentService, AuthService authService) {
        this.tournamentService = tournamentService;
        this.authService = authService;
    }

    @GetMapping
    public ResponseEntity<List<TournamentSummaryDto>> listTournaments() {
        return ResponseEntity.ok(tournamentService.listTournaments());
    }

    @GetMapping("/{id}")
    public ResponseEntity<TournamentDetailDto> getTournament(
        @PathVariable Long id,
        @RequestHeader(value = "Authorization", required = false) String authorization
    ) {
        Long currentUserId = extractUserIdOrNull(authorization);
        return ResponseEntity.ok(tournamentService.getTournament(id, currentUserId));
    }

    @PostMapping
    public ResponseEntity<TournamentSummaryDto> createTournament(
        @RequestHeader(value = "Authorization", required = false) String authorization,
        @RequestBody CreateTournamentRequest request
    ) {
        // V1: creación permitida a cualquier usuario autenticado.
        requireAuthenticatedUser(authorization);
        return ResponseEntity.status(HttpStatus.CREATED).body(tournamentService.createTournament(request));
    }

    @PostMapping("/{id}/join")
    public ResponseEntity<TournamentDetailDto> joinTournament(
        @PathVariable Long id,
        @RequestHeader(value = "Authorization", required = false) String authorization,
        @RequestBody JoinTournamentRequest request
    ) {
        Long userId = requireAuthenticatedUser(authorization);
        return ResponseEntity.ok(tournamentService.joinTournament(id, userId, request.getDeckId()));
    }

    private Long extractUserIdOrNull(String authorization) {
        if (authorization == null || !authorization.startsWith("Bearer ")) {
            return null;
        }
        String token = authorization.substring("Bearer ".length());
        return authService.getUserId(token).orElse(null);
    }

    private Long requireAuthenticatedUser(String authorization) {
        if (authorization == null || !authorization.startsWith("Bearer ")) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Token no proporcionado");
        }

        String token = authorization.substring("Bearer ".length());
        return authService.getUserId(token)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Token inválido"));
    }
}
