package com.magicvs.backend.repository;

import com.magicvs.backend.model.TournamentParticipant;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface TournamentParticipantRepository extends JpaRepository<TournamentParticipant, Long> {

    boolean existsByTournamentIdAndUserId(Long tournamentId, Long userId);

    long countByTournamentId(Long tournamentId);

    List<TournamentParticipant> findByTournamentIdOrderByJoinedAtAsc(Long tournamentId);

    Optional<TournamentParticipant> findByTournamentIdAndUserId(Long tournamentId, Long userId);
}
