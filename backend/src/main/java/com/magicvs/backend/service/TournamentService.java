package com.magicvs.backend.service;

import com.magicvs.backend.dto.*;
import com.magicvs.backend.model.*;
import com.magicvs.backend.repository.*;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.time.LocalDateTime;
import java.util.*;

@Service
@Transactional(readOnly = true)
public class TournamentService {

    private static final Set<Integer> ALLOWED_SIZES = Set.of(8, 16, 32);

    private final TournamentRepository tournamentRepository;
    private final TournamentParticipantRepository participantRepository;
    private final TournamentMatchRepository matchRepository;
    private final MatchRepository arenaMatchRepository;
    private final RegistroRepository userRepository;
    private final DeckRepository deckRepository;
    private final NotificationService notificationService;

    public TournamentService(
        TournamentRepository tournamentRepository,
        TournamentParticipantRepository participantRepository,
        TournamentMatchRepository matchRepository,
        MatchRepository arenaMatchRepository,
        RegistroRepository userRepository,
        DeckRepository deckRepository,
        NotificationService notificationService
    ) {
        this.tournamentRepository = tournamentRepository;
        this.participantRepository = participantRepository;
        this.matchRepository = matchRepository;
        this.arenaMatchRepository = arenaMatchRepository;
        this.userRepository = userRepository;
        this.deckRepository = deckRepository;
        this.notificationService = notificationService;
    }

    public List<TournamentSummaryDto> listTournaments() {
        return tournamentRepository.findAllByOrderByCreatedAtDesc()
            .stream()
            .map(this::toSummary)
            .toList();
    }

    public TournamentDetailDto getTournament(Long tournamentId, Long currentUserId) {
        Tournament tournament = tournamentRepository.findById(tournamentId)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Torneo no encontrado"));

        List<TournamentParticipant> participants = participantRepository.findByTournamentIdOrderByJoinedAtAsc(tournamentId);
        List<TournamentMatch> matches = matchRepository.findByTournamentIdOrderByRoundNumberAscMatchNumberAsc(tournamentId);

        boolean joined = currentUserId != null && participantRepository.existsByTournamentIdAndUserId(tournamentId, currentUserId);
        int currentRound = matches.stream().map(TournamentMatch::getRoundNumber).max(Integer::compareTo).orElse(1);

        return new TournamentDetailDto(
            tournament.getId(),
            tournament.getName(),
            tournament.getDescription(),
            tournament.getMaxPlayers(),
            participants.size(),
            tournament.getStatus(),
            tournament.getStartDate(),
            tournament.getWinnerUserId(),
            currentRound,
            joined,
            participants.stream().map(this::toParticipantDto).toList(),
            matches.stream().map(this::toMatchDto).toList()
        );
    }

    @Transactional
    public TournamentSummaryDto createTournament(CreateTournamentRequest request) {
        validateCreateRequest(request);

        Tournament tournament = new Tournament();
        tournament.setName(request.getName().trim());
        tournament.setDescription(request.getDescription());
        tournament.setMaxPlayers(request.getMaxPlayers());
        tournament.setStatus(TournamentStatus.PENDING);
        tournament.setStartDate(request.getStartDate());

        Tournament saved = tournamentRepository.save(tournament);
        return toSummary(saved);
    }

    @Transactional
    public TournamentDetailDto joinTournament(Long tournamentId, Long userId, Long deckId) {
        if (deckId == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Debes seleccionar un mazo para participar");
        }

        Tournament tournament = tournamentRepository.findByIdForUpdate(tournamentId)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Torneo no encontrado"));

        if (tournament.getStatus() != TournamentStatus.PENDING) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "La inscripción está cerrada para este torneo");
        }

        if (participantRepository.existsByTournamentIdAndUserId(tournamentId, userId)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Ya estás inscrito en este torneo");
        }

        long currentParticipants = participantRepository.countByTournamentId(tournamentId);
        if (currentParticipants >= tournament.getMaxPlayers()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "El torneo ya está completo");
        }

        User user = userRepository.findById(userId)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Usuario no encontrado"));

        Deck deck = deckRepository.findById(deckId)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Mazo no encontrado"));

        if (!deck.getUser().getId().equals(userId)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Solo puedes inscribirte con un mazo propio");
        }

        TournamentParticipant participant = new TournamentParticipant();
        participant.setTournament(tournament);
        participant.setUser(user);
        participant.setDeck(deck);
        participantRepository.save(participant);

        long updatedCount = participantRepository.countByTournamentId(tournamentId);
        if (updatedCount == tournament.getMaxPlayers()) {
            activateTournamentAndCreateFirstRound(tournament);
        }

        return getTournament(tournamentId, userId);
    }

    @Transactional
    public TournamentMatchDto reportMatchResult(Long matchId, Long reporterId, Long winnerId) {
        if (winnerId == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Debes indicar el ganador del enfrentamiento");
        }

        TournamentMatch match = matchRepository.findById(matchId)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Match no encontrado"));

        Tournament tournament = match.getTournament();
        if (tournament.getStatus() != TournamentStatus.ACTIVE) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Este torneo no admite reportes en su estado actual");
        }

        if (!match.hasPlayer(reporterId)) {
            match.setStatus(MatchStatus.REVIEW);
            match.setReportedByUserId(reporterId);
            matchRepository.save(match);
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Solo los participantes del match pueden reportar resultado");
        }

        if (!Objects.equals(winnerId, match.getPlayer1Id()) && !Objects.equals(winnerId, match.getPlayer2Id())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "El ganador debe ser uno de los dos jugadores del match");
        }

        if (match.getStatus() == MatchStatus.FINISHED && Objects.equals(match.getWinnerId(), winnerId)) {
            return toMatchDto(match);
        }

        match.setWinnerId(winnerId);
        match.setReportedByUserId(reporterId);
        match.setStatus(MatchStatus.FINISHED);
        matchRepository.save(match);

        int round = match.getRoundNumber();
        boolean hasOpenMatches = matchRepository.existsByTournamentIdAndRoundNumberAndStatusIn(
            tournament.getId(),
            round,
            List.of(MatchStatus.PENDING, MatchStatus.PLAYING, MatchStatus.REVIEW)
        );

        if (!hasOpenMatches) {
            closeRoundAndAdvanceIfNeeded(tournament, round);
        }

        return toMatchDto(match);
    }

    @Transactional
    public TournamentMatchAcceptanceDto acceptTournamentMatch(Long matchId, Long userId) {
        TournamentMatch match = matchRepository.findById(matchId)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Match no encontrado"));

        if (!match.hasPlayer(userId)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Solo los participantes pueden confirmar este match");
        }

        if (match.getStatus() == MatchStatus.FINISHED) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Este match ya ha finalizado");
        }

        if (match.getBattleMatchId() != null) {
            return new TournamentMatchAcceptanceDto(
                match.getId(),
                match.getBattleMatchId(),
                match.getStatus(),
                true,
                false,
                "/battle/" + match.getBattleMatchId(),
                null,
                null
            );
        }

        if (Objects.equals(userId, match.getPlayer1Id())) {
            match.setPlayer1Accepted(true);
        }
        if (Objects.equals(userId, match.getPlayer2Id())) {
            match.setPlayer2Accepted(true);
        }

        boolean bothAccepted = Boolean.TRUE.equals(match.getPlayer1Accepted()) && Boolean.TRUE.equals(match.getPlayer2Accepted());
        if (!bothAccepted) {
            TournamentMatch saved = matchRepository.save(match);
            return new TournamentMatchAcceptanceDto(
                saved.getId(),
                null,
                saved.getStatus(),
                false,
                false,
                "/tournaments/" + saved.getTournament().getId(),
                null,
                null
            );
        }

        ArenaMatchLaunch launch = createBattleMatchForTournamentMatch(match);
        notifyTournamentBattleStarted(match.getTournament().getId(), match);

        return new TournamentMatchAcceptanceDto(
            match.getId(),
            launch.matchId(),
            match.getStatus(),
            true,
            true,
            "/battle/" + launch.matchId(),
            launch.deck1Id(),
            launch.deck2Id()
        );
    }

    @Transactional
    public Optional<TournamentMatchDto> completeArenaMatchResult(Long arenaMatchId, Long winnerId) {
        return matchRepository.findByBattleMatchId(arenaMatchId)
            .map(match -> reportMatchResult(match.getId(), winnerId, winnerId));
    }

    private void validateCreateRequest(CreateTournamentRequest request) {
        if (request == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Payload inválido");
        }
        if (request.getName() == null || request.getName().trim().isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "El nombre del torneo es obligatorio");
        }
        if (request.getMaxPlayers() == null || !ALLOWED_SIZES.contains(request.getMaxPlayers())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "maxPlayers debe ser 8, 16 o 32");
        }
    }

    private void activateTournamentAndCreateFirstRound(Tournament tournament) {
        tournament.setStatus(TournamentStatus.ACTIVE);
        if (tournament.getStartDate() == null) {
            tournament.setStartDate(LocalDateTime.now());
        }
        tournamentRepository.save(tournament);

        List<TournamentParticipant> participants = participantRepository.findByTournamentIdOrderByJoinedAtAsc(tournament.getId());
        List<Long> userIds = new ArrayList<>(participants.stream().map(p -> p.getUser().getId()).toList());
        Collections.shuffle(userIds);

        createRoundMatches(tournament, 1, userIds);
    }

    private void closeRoundAndAdvanceIfNeeded(Tournament tournament, int round) {
        List<TournamentMatch> currentRound = matchRepository.findByTournamentIdAndRoundNumberOrderByMatchNumberAsc(tournament.getId(), round);
        List<Long> winners = currentRound.stream()
            .map(TournamentMatch::getWinnerId)
            .filter(Objects::nonNull)
            .toList();

        if (winners.isEmpty()) {
            return;
        }

        if (winners.size() == 1 && currentRound.size() == 1) {
            tournament.setStatus(TournamentStatus.COMPLETED);
            tournament.setWinnerUserId(winners.get(0));
            tournamentRepository.save(tournament);
            notifyTournamentWinner(tournament.getId(), winners.get(0));
            return;
        }

        int nextRound = round + 1;
        if (matchRepository.existsByTournamentIdAndRoundNumber(tournament.getId(), nextRound)) {
            return;
        }

        createRoundMatches(tournament, nextRound, winners);
    }

    private void createRoundMatches(Tournament tournament, int round, List<Long> playerIds) {
        List<Long> queue = new ArrayList<>(playerIds);
        int matchNumber = 1;

        while (!queue.isEmpty()) {
            Long p1 = queue.remove(0);
            Long p2 = queue.isEmpty() ? null : queue.remove(0);

            TournamentMatch match = new TournamentMatch();
            match.setTournament(tournament);
            match.setRoundNumber(round);
            match.setMatchNumber(matchNumber++);
            match.setPlayer1Id(p1);
            match.setPlayer2Id(p2);

            if (p2 == null) {
                match.setWinnerId(p1);
                match.setStatus(MatchStatus.FINISHED);
            } else {
                match.setStatus(MatchStatus.PENDING);
            }

            TournamentMatch saved = matchRepository.save(match);
            if (saved.getStatus() == MatchStatus.PENDING) {
                notifyPlayersMatchReady(tournament.getId(), saved);
            }
        }

        // Si hubo bye y todos quedaron finalizados, sigue avanzando automáticamente.
        boolean hasOpenMatches = matchRepository.existsByTournamentIdAndRoundNumberAndStatusIn(
            tournament.getId(),
            round,
            List.of(MatchStatus.PENDING, MatchStatus.PLAYING, MatchStatus.REVIEW)
        );

        if (!hasOpenMatches) {
            closeRoundAndAdvanceIfNeeded(tournament, round);
        }
    }

    private ArenaMatchLaunch createBattleMatchForTournamentMatch(TournamentMatch tournamentMatch) {
        if (tournamentMatch.getBattleMatchId() != null) {
            Match arenaMatch = arenaMatchRepository.findById(tournamentMatch.getBattleMatchId())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Partida de arena no encontrada"));
            return new ArenaMatchLaunch(arenaMatch.getId(), arenaMatch.getDeck1Id(), arenaMatch.getDeck2Id());
        }

        Long p1 = tournamentMatch.getPlayer1Id();
        Long p2 = tournamentMatch.getPlayer2Id();
        if (p1 == null || p2 == null) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "El match de torneo no tiene dos jugadores");
        }

        User player1 = userRepository.findById(p1)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Jugador 1 no encontrado"));
        User player2 = userRepository.findById(p2)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Jugador 2 no encontrado"));

        Long tournamentId = tournamentMatch.getTournament().getId();
        Long deck1Id = participantRepository.findByTournamentIdAndUserId(tournamentId, p1)
            .map(participant -> participant.getDeck().getId())
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Mazo del jugador 1 no encontrado"));
        Long deck2Id = participantRepository.findByTournamentIdAndUserId(tournamentId, p2)
            .map(participant -> participant.getDeck().getId())
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Mazo del jugador 2 no encontrado"));

        Match arenaMatch = new Match();
        arenaMatch.setPlayer1(player1);
        arenaMatch.setPlayer2(player2);
        arenaMatch.setDeck1Id(deck1Id);
        arenaMatch.setDeck2Id(deck2Id);
        arenaMatch.setStatus(MatchStatus.LIVE);
        arenaMatch.setFormat("Tournament");

        Match savedArenaMatch = arenaMatchRepository.save(arenaMatch);

        tournamentMatch.setBattleMatchId(savedArenaMatch.getId());
        tournamentMatch.setStatus(MatchStatus.PLAYING);
        matchRepository.save(tournamentMatch);

        return new ArenaMatchLaunch(savedArenaMatch.getId(), deck1Id, deck2Id);
    }

    private void notifyPlayersMatchReady(Long tournamentId, TournamentMatch match) {
        Long p1 = match.getPlayer1Id();
        Long p2 = match.getPlayer2Id();

        String p1Name = resolveUserName(p1);
        String p2Name = resolveUserName(p2);
        String tournamentLink = "/tournaments/" + tournamentId;

        if (p1 != null) {
            Map<String, Object> data = new HashMap<>();
            data.put("title", "Match de torneo listo");
            data.put("message", "Tu rival es " + p2Name + ". Confirma que estás listo para crear la partida.");
            data.put("link", tournamentLink);
            data.put("tournamentId", tournamentId);
            data.put("tournamentMatchId", match.getId());
            notificationService.createNotification(p1, NotificationType.BATTLE_INVITE, data);
        }

        if (p2 != null) {
            Map<String, Object> data = new HashMap<>();
            data.put("title", "Match de torneo listo");
            data.put("message", "Tu rival es " + p1Name + ". Confirma que estás listo para crear la partida.");
            data.put("link", tournamentLink);
            data.put("tournamentId", tournamentId);
            data.put("tournamentMatchId", match.getId());
            notificationService.createNotification(p2, NotificationType.BATTLE_INVITE, data);
        }
    }

    private void notifyTournamentBattleStarted(Long tournamentId, TournamentMatch match) {
        if (match.getBattleMatchId() == null) {
            return;
        }

        String battleLink = "/battle/" + match.getBattleMatchId();
        for (Long userId : List.of(match.getPlayer1Id(), match.getPlayer2Id())) {
            if (userId == null) {
                continue;
            }

            Map<String, Object> data = new HashMap<>();
            data.put("title", "Partida de torneo creada");
            data.put("message", "Ambos jugadores han confirmado. Entra a la arena para jugar el match.");
            data.put("link", battleLink);
            data.put("tournamentId", tournamentId);
            data.put("tournamentMatchId", match.getId());
            data.put("matchId", match.getBattleMatchId());
            notificationService.createNotification(userId, NotificationType.MATCH_FOUND, data);
        }
    }

    private void notifyTournamentWinner(Long tournamentId, Long winnerId) {
        Map<String, Object> data = new HashMap<>();
        data.put("title", "¡Campeón del torneo!");
        data.put("message", "Has ganado el torneo. ¡Felicidades!");
        data.put("link", "/tournaments/" + tournamentId);
        data.put("tournamentId", tournamentId);
        notificationService.createNotification(winnerId, NotificationType.SYSTEM, data);
    }

    private String resolveUserName(Long userId) {
        return userRepository.findById(userId)
            .map(user -> user.getDisplayName() != null && !user.getDisplayName().isBlank() ? user.getDisplayName() : user.getUsername())
            .orElse("Jugador");
    }

    private TournamentSummaryDto toSummary(Tournament tournament) {
        long participantCount = participantRepository.countByTournamentId(tournament.getId());
        return new TournamentSummaryDto(
            tournament.getId(),
            tournament.getName(),
            tournament.getDescription(),
            tournament.getMaxPlayers(),
            participantCount,
            tournament.getStatus(),
            tournament.getStartDate(),
            tournament.getWinnerUserId()
        );
    }

    private TournamentParticipantDto toParticipantDto(TournamentParticipant participant) {
        String displayName = participant.getUser().getDisplayName();
        return new TournamentParticipantDto(
            participant.getUser().getId(),
            participant.getUser().getUsername(),
            displayName,
            participant.getDeck().getId(),
            participant.getDeck().getName(),
            participant.getJoinedAt()
        );
    }

    private TournamentMatchDto toMatchDto(TournamentMatch match) {
        return new TournamentMatchDto(
            match.getId(),
            match.getRoundNumber(),
            match.getMatchNumber(),
            match.getPlayer1Id(),
            match.getPlayer2Id(),
            match.getWinnerId(),
            match.getBattleMatchId(),
            match.getPlayer1Accepted(),
            match.getPlayer2Accepted(),
            match.getStatus()
        );
    }

    private record ArenaMatchLaunch(Long matchId, Long deck1Id, Long deck2Id) {
    }
}
