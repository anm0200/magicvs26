package com.magicvs.backend.service;

import com.magicvs.backend.model.*;
import com.magicvs.backend.repository.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.client.RestTemplate;
import tools.jackson.databind.JsonNode;

import java.net.URI;
import java.time.LocalDate;
import java.util.*;

import org.springframework.context.annotation.Profile;

@Service
public class ScryfallMigrationService {

    private static final Logger log = LoggerFactory.getLogger(ScryfallMigrationService.class);
    private static final String SCRYFALL_MIGRATIONS_URL = "https://api.scryfall.com/migrations";

    @Autowired
    private RestTemplate restTemplate;

    @Autowired
    private CardRepository cardRepository;

    @Autowired
    private DeckCardRepository deckCardRepository;

    @Autowired
    private FavoriteCardRepository favoriteCardRepository;

    @Autowired
    private AppliedMigrationRepository appliedMigrationRepository;

    @Autowired
    private ScryfallService scryfallService;

    @Autowired
    @Lazy
    private ScryfallMigrationService self;



    /**
     * Consulta la API de Scryfall para obtener y aplicar las migraciones no procesadas.
     * @return El número de migraciones aplicadas.
     */
    public int applyMigrations() {
        log.info("Obteniendo migraciones desde la API de Scryfall...");
        List<JsonNode> unappliedNodes = new ArrayList<>();
        String nextUrl = SCRYFALL_MIGRATIONS_URL;

        // 1. Recorrer las páginas de migraciones hasta encontrar una página donde todas las migraciones ya estén aplicadas
        // o hasta que no haya más páginas.
        while (nextUrl != null) {
            try {
                log.info("Consultando URL de migraciones: {}", nextUrl);
                JsonNode response = restTemplate.getForObject(URI.create(nextUrl), JsonNode.class);
                if (response == null || !response.has("data")) {
                    break;
                }

                JsonNode data = response.get("data");
                boolean foundNewInPage = false;

                for (JsonNode migrationNode : data) {
                    UUID id = UUID.fromString(migrationNode.get("id").asText());
                    if (!appliedMigrationRepository.existsById(id)) {
                        unappliedNodes.add(migrationNode);
                        foundNewInPage = true;
                    }
                }

                // Si no hay ninguna migración nueva en esta página, significa que ya hemos procesado
                // todo lo anterior (ya que vienen ordenadas de más nuevas a más antiguas).
                if (!foundNewInPage) {
                    log.info("Todas las migraciones de esta página ya han sido aplicadas. Deteniendo paginación.");
                    break;
                }

                if (response.has("has_more") && response.get("has_more").asBoolean()) {
                    nextUrl = response.get("next_page").asText();
                    // Rate limit friendly
                    Thread.sleep(100);
                } else {
                    nextUrl = null;
                }
            } catch (Exception e) {
                log.error("Error al paginar migraciones de Scryfall", e);
                break;
            }
        }

        if (unappliedNodes.isEmpty()) {
            log.info("No hay migraciones nuevas que aplicar.");
            return 0;
        }

        // 2. Revertir la lista para procesarlas cronológicamente (de la más antigua a la más nueva)
        Collections.reverse(unappliedNodes);
        log.info("Se encontraron {} migraciones nuevas para procesar.", unappliedNodes.size());

        int count = 0;
        for (JsonNode node : unappliedNodes) {
            UUID migrationId = UUID.fromString(node.get("id").asText());
            try {
                self.applySingleMigration(node);
                count++;
            } catch (Exception e) {
                log.error("Error al aplicar la migración con ID {}: {}", migrationId, e.getMessage(), e);
            }
        }

        return count;
    }

    /**
     * Aplica una única migración en una transacción separada.
     */
    @Transactional
    public void applySingleMigration(JsonNode node) {
        UUID id = UUID.fromString(node.get("id").asText());
        
        // Evitar doble aplicación en caso de ejecución concurrente rápida
        if (appliedMigrationRepository.existsById(id)) {
            return;
        }

        String strategy = node.get("migration_strategy").asText();
        UUID oldScryfallId = UUID.fromString(node.get("old_scryfall_id").asText());
        LocalDate performedAt = LocalDate.parse(node.get("performed_at").asText());
        
        log.info("Aplicando migración {}: estrategia={}, old_id={}", id, strategy, oldScryfallId);

        Optional<Card> oldCardOpt = cardRepository.findByScryfallId(oldScryfallId);
        
        if (oldCardOpt.isPresent()) {
            Card oldCard = oldCardOpt.get();
            log.info("La carta obsoleta '{}' (ID interno {}) está en la base de datos local.", oldCard.getName(), oldCard.getId());
            
            if ("merge".equals(strategy)) {
                UUID newScryfallId = UUID.fromString(node.get("new_scryfall_id").asText());
                log.info("Fusionando carta con nueva Scryfall ID: {}", newScryfallId);
                
                // Obtener o importar la nueva carta
                Card newCard = cardRepository.findByScryfallId(newScryfallId)
                        .orElseGet(() -> {
                            log.info("La nueva carta con ID {} no existe localmente. Importando...", newScryfallId);
                            Card imported = scryfallService.importCardByScryfallId(newScryfallId);
                            if (imported == null) {
                                throw new IllegalStateException("No se pudo importar la nueva carta con ID " + newScryfallId);
                            }
                            return imported;
                        });

                // 1. Actualizar las relaciones de DeckCard
                List<DeckCard> oldDeckCards = deckCardRepository.findByCardId(oldCard.getId());
                log.info("Actualizando {} relaciones de DeckCard...", oldDeckCards.size());
                for (DeckCard oldDc : oldDeckCards) {
                    Deck deck = oldDc.getDeck();
                    Optional<DeckCard> newDcOpt = deckCardRepository.findByDeckIdAndCardId(deck.getId(), newCard.getId());
                    
                    if (newDcOpt.isPresent()) {
                        DeckCard newDc = newDcOpt.get();
                        newDc.setQuantity(newDc.getQuantity() + oldDc.getQuantity());
                        deckCardRepository.save(newDc);
                        deckCardRepository.delete(oldDc);
                        log.info("Mazo {}: Ya contenía la nueva carta. Se sumaron las cantidades y se borró la relación vieja.", deck.getId());
                    } else {
                        oldDc.setCard(newCard);
                        deckCardRepository.save(oldDc);
                        log.info("Mazo {}: Se actualizó la relación de la carta obsoleta a la nueva.", deck.getId());
                    }
                }

                // 2. Actualizar las relaciones de FavoriteCard
                List<FavoriteCard> oldFavs = favoriteCardRepository.findByCardId(oldCard.getId());
                log.info("Actualizando {} favoritos...", oldFavs.size());
                for (FavoriteCard oldFav : oldFavs) {
                    User user = oldFav.getUser();
                    boolean existsNewFav = favoriteCardRepository.existsByUserIdAndCardId(user.getId(), newCard.getId());
                    
                    if (existsNewFav) {
                        favoriteCardRepository.delete(oldFav);
                        log.info("Usuario {}: Ya tenía la nueva carta en favoritos. Se eliminó el favorito obsoleto.", user.getId());
                    } else {
                        oldFav.setCard(newCard);
                        favoriteCardRepository.save(oldFav);
                        log.info("Usuario {}: Se actualizó el favorito de la carta obsoleta a la nueva.", user.getId());
                    }
                }

                // 3. Eliminar la carta obsoleta
                cardRepository.delete(oldCard);
                log.info("Carta obsoleta '{}' eliminada con éxito.", oldCard.getName());

                // Guardar log de migración aplicada
                AppliedMigration applied = new AppliedMigration(id, strategy, oldScryfallId, newScryfallId, performedAt);
                appliedMigrationRepository.save(applied);

            } else if ("delete".equals(strategy)) {
                log.info("Eliminando carta obsoleta...");
                
                // 1. Eliminar relaciones de DeckCard y FavoriteCard para evitar errores de clave foránea
                deckCardRepository.deleteByCardId(oldCard.getId());
                favoriteCardRepository.deleteByCardId(oldCard.getId());
                
                // 2. Eliminar la carta obsoleta
                cardRepository.delete(oldCard);
                log.info("Carta obsoleta '{}' y sus relaciones asociadas eliminadas con éxito.", oldCard.getName());

                // Guardar log de migración aplicada
                AppliedMigration applied = new AppliedMigration(id, strategy, oldScryfallId, null, performedAt);
                appliedMigrationRepository.save(applied);
            }
        } else {
            // Si la carta vieja no está en nuestra base de datos, simplemente registramos la migración
            // como aplicada para no volver a considerarla en futuras iteraciones.
            log.debug("La carta obsoleta con ID {} no está en la base de datos local. Omitiendo cambios.", oldScryfallId);
            
            UUID newScryfallId = strategy.equals("merge") && node.hasNonNull("new_scryfall_id")
                    ? UUID.fromString(node.get("new_scryfall_id").asText())
                    : null;
            
            AppliedMigration applied = new AppliedMigration(id, strategy, oldScryfallId, newScryfallId, performedAt);
            appliedMigrationRepository.save(applied);
        }
    }
}
