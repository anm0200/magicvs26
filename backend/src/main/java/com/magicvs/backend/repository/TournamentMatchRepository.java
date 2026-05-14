package com.magicvs.backend.repository;

import com.magicvs.backend.model.MatchStatus;
import com.magicvs.backend.model.TournamentMatch;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;

public interface TournamentMatchRepository extends JpaRepository<TournamentMatch, Long> {

    List<TournamentMatch> findByTournamentIdOrderByRoundNumberAscMatchNumberAsc(Long tournamentId);

    List<TournamentMatch> findByTournamentIdAndRoundNumberOrderByMatchNumberAsc(Long tournamentId, Integer roundNumber);

    boolean existsByTournamentIdAndRoundNumberAndStatusIn(Long tournamentId, Integer roundNumber, Collection<MatchStatus> statuses);

    boolean existsByTournamentIdAndRoundNumber(Long tournamentId, Integer roundNumber);
}
