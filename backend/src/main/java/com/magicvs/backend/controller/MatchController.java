package com.magicvs.backend.controller;

import com.magicvs.backend.dto.MatchHistoryDto;
import com.magicvs.backend.dto.ReportMatchRequest;
import com.magicvs.backend.dto.TournamentMatchAcceptanceDto;
import com.magicvs.backend.dto.TournamentMatchDto;
import com.magicvs.backend.service.AuthService;
import com.magicvs.backend.service.BattleService;
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
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;

import static org.springframework.http.HttpStatus.UNAUTHORIZED;

@RestController
@CrossOrigin(origins = "http://localhost:4200")
@RequestMapping("/api/matches")
public class MatchController {

    private final TournamentService tournamentService;
    private final MatchService matchService;
    private final AuthService authService;
    private final com.magicvs.backend.service.BattleService battleService;
    private final com.magicvs.backend.repository.FriendshipRepository friendshipRepository;
    private final com.magicvs.backend.repository.RegistroRepository registroRepository;

    public MatchController(
            TournamentService tournamentService,
            MatchService matchService,
            AuthService authService,
            com.magicvs.backend.service.BattleService battleService,
            com.magicvs.backend.repository.FriendshipRepository friendshipRepository,
            com.magicvs.backend.repository.RegistroRepository registroRepository) {
        this.tournamentService = tournamentService;
        this.matchService = matchService;
        this.authService = authService;
        this.battleService = battleService;
        this.friendshipRepository = friendshipRepository;
        this.registroRepository = registroRepository;
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

    @PostMapping("/{id}/accept")
    public ResponseEntity<TournamentMatchAcceptanceDto> acceptTournamentMatch(
            @PathVariable Long id,
            @RequestHeader(value = "Authorization", required = false) String authorization) {
        Long userId = requireAuthenticatedUser(authorization);
        TournamentMatchAcceptanceDto accepted = tournamentService.acceptTournamentMatch(id, userId);
        if (accepted.battleMatchCreated() && accepted.battleMatchId() != null) {
            battleService.initializeMatch(accepted.battleMatchId(), accepted.deck1Id(), accepted.deck2Id());
        }
        return ResponseEntity.ok(accepted);
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

    @GetMapping("/friends/active")
    public ResponseEntity<List<MatchHistoryDto>> getActiveFriendsMatches(@RequestHeader("Authorization") String token) {
        Long userId = authService.getUserId(token.replace("Bearer ", ""))
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid token"));
        
        List<MatchHistoryDto> activeMatches = matchService.getActiveMatchesForFriends(userId);
        return ResponseEntity.ok(activeMatches);
    }

    @GetMapping("/{id}/spectate")
    public ResponseEntity<com.magicvs.backend.service.BattleService.GameState> spectateMatch(
            @RequestHeader("Authorization") String token,
            @PathVariable Long id,
            @RequestParam Long friendId) {
            
        Long userId = authService.getUserId(token.replace("Bearer ", ""))
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid token"));
                
        com.magicvs.backend.model.User user = registroRepository.findById(userId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "User not found"));
        com.magicvs.backend.model.User friend = registroRepository.findById(friendId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Friend not found"));

        if (!friendshipRepository.existsByUserAndFriend(user, friend) && !friendshipRepository.existsByUserAndFriend(friend, user)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Not friends with this user");
        }

        com.magicvs.backend.service.BattleService.GameState state = battleService.getSpectatorState(userId, id, friendId);
        if (state == null) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok(state);
    }
}
