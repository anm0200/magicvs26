package com.magicvs.backend.repository;

import com.magicvs.backend.model.DeckCard;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface DeckCardRepository extends JpaRepository<DeckCard, Long> {

    List<DeckCard> findByDeckId(Long deckId);

    List<DeckCard> findByCardId(Long cardId);

    void deleteByDeckId(Long deckId);

    void deleteByCardId(Long cardId);

    void deleteByDeckIdAndCardId(Long deckId, Long cardId);

    java.util.Optional<DeckCard> findByDeckIdAndCardId(Long deckId, Long cardId);
}
