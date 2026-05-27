package com.magicvs.backend.service;

import com.magicvs.backend.model.*;
import com.magicvs.backend.repository.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.Mockito;
import org.mockito.Spy;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.web.client.RestTemplate;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

import java.net.URI;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.*;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class ScryfallMigrationServiceTest {

    @Mock
    private RestTemplate restTemplate;

    @Mock
    private CardRepository cardRepository;

    @Mock
    private DeckCardRepository deckCardRepository;

    @Mock
    private FavoriteCardRepository favoriteCardRepository;

    @Mock
    private AppliedMigrationRepository appliedMigrationRepository;

    @Mock
    private ScryfallService scryfallService;

    @InjectMocks
    @Spy
    private ScryfallMigrationService scryfallMigrationService;

    private final ObjectMapper mapper = new ObjectMapper();

    @BeforeEach
    void setUp() {
        try {
            java.lang.reflect.Field selfField = ScryfallMigrationService.class.getDeclaredField("self");
            selfField.setAccessible(true);
            selfField.set(scryfallMigrationService, scryfallMigrationService);
        } catch (Exception e) {
            fail(e);
        }
    }

    @Test
    void testApplyMigrations_NoNewMigrations() {
        ObjectNode rootNode = mapper.createObjectNode();
        rootNode.put("object", "list");
        rootNode.put("has_more", false);
        ArrayNode dataArray = mapper.createArrayNode();
        rootNode.set("data", dataArray);

        UUID migrationId = UUID.randomUUID();
        ObjectNode migrationNode = mapper.createObjectNode();
        migrationNode.put("id", migrationId.toString());
        migrationNode.put("migration_strategy", "merge");
        migrationNode.put("old_scryfall_id", UUID.randomUUID().toString());
        migrationNode.put("new_scryfall_id", UUID.randomUUID().toString());
        migrationNode.put("performed_at", "2024-02-13");
        dataArray.add(migrationNode);

        when(restTemplate.getForObject(any(URI.class), eq(JsonNode.class))).thenReturn(rootNode);
        when(appliedMigrationRepository.existsById(migrationId)).thenReturn(true);

        int count = scryfallMigrationService.applyMigrations();
        assertEquals(0, count);
        verify(scryfallMigrationService, never()).applySingleMigration(any());
    }

    @Test
    void testApplySingleMigration_Merge_NewCardExists() {
        UUID migrationId = UUID.randomUUID();
        UUID oldScryfallId = UUID.randomUUID();
        UUID newScryfallId = UUID.randomUUID();

        ObjectNode migrationNode = mapper.createObjectNode();
        migrationNode.put("id", migrationId.toString());
        migrationNode.put("migration_strategy", "merge");
        migrationNode.put("old_scryfall_id", oldScryfallId.toString());
        migrationNode.put("new_scryfall_id", newScryfallId.toString());
        migrationNode.put("performed_at", "2024-02-13");

        Card oldCard = new Card();
        oldCard.setScryfallId(oldScryfallId);
        setId(oldCard, 100L);
        oldCard.setName("Old Card Name");

        Card newCard = new Card();
        newCard.setScryfallId(newScryfallId);
        setId(newCard, 200L);
        newCard.setName("New Card Name");

        when(appliedMigrationRepository.existsById(migrationId)).thenReturn(false);
        when(cardRepository.findByScryfallId(oldScryfallId)).thenReturn(Optional.of(oldCard));
        when(cardRepository.findByScryfallId(newScryfallId)).thenReturn(Optional.of(newCard));

        Deck deck = new Deck();
        setId(deck, 1L);
        DeckCard oldDc = new DeckCard(deck, oldCard, 2);
        
        when(deckCardRepository.findByCardId(100L)).thenReturn(List.of(oldDc));
        when(deckCardRepository.findByDeckIdAndCardId(1L, 200L)).thenReturn(Optional.empty());

        User user = new User();
        setId(user, 50L);
        FavoriteCard oldFav = new FavoriteCard(user, oldCard);

        when(favoriteCardRepository.findByCardId(100L)).thenReturn(List.of(oldFav));
        when(favoriteCardRepository.existsByUserIdAndCardId(50L, 200L)).thenReturn(false);

        scryfallMigrationService.applySingleMigration(migrationNode);

        assertEquals(newCard, oldDc.getCard());
        verify(deckCardRepository).save(oldDc);
        assertEquals(newCard, oldFav.getCard());
        verify(favoriteCardRepository).save(oldFav);
        verify(cardRepository).delete(oldCard);
        verify(appliedMigrationRepository).save(any(AppliedMigration.class));
    }

    @Test
    void testApplySingleMigration_Delete() {
        UUID migrationId = UUID.randomUUID();
        UUID oldScryfallId = UUID.randomUUID();

        ObjectNode migrationNode = mapper.createObjectNode();
        migrationNode.put("id", migrationId.toString());
        migrationNode.put("migration_strategy", "delete");
        migrationNode.put("old_scryfall_id", oldScryfallId.toString());
        migrationNode.put("performed_at", "2024-02-13");

        Card oldCard = new Card();
        oldCard.setScryfallId(oldScryfallId);
        setId(oldCard, 100L);
        oldCard.setName("Obsolete Card");

        when(appliedMigrationRepository.existsById(migrationId)).thenReturn(false);
        when(cardRepository.findByScryfallId(oldScryfallId)).thenReturn(Optional.of(oldCard));

        scryfallMigrationService.applySingleMigration(migrationNode);

        verify(deckCardRepository).deleteByCardId(100L);
        verify(favoriteCardRepository).deleteByCardId(100L);
        verify(cardRepository).delete(oldCard);
        verify(appliedMigrationRepository).save(any(AppliedMigration.class));
    }

    private void setId(Object target, Long id) {
        try {
            java.lang.reflect.Field field = target.getClass().getDeclaredField("id");
            field.setAccessible(true);
            field.set(target, id);
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }
}
