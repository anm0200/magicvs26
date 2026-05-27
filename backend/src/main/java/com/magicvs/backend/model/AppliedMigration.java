package com.magicvs.backend.model;
import jakarta.persistence.*;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.UUID;

@Entity
@Table(name = "applied_migrations")
public class AppliedMigration {

    @Id
    private UUID id; // Scryfall's migration ID

    @Column(nullable = false)
    private String strategy; // "merge" or "delete"

    @Column(name = "old_scryfall_id", nullable = false)
    private UUID oldScryfallId;

    @Column(name = "new_scryfall_id")
    private UUID newScryfallId; // null if strategy is "delete"

    @Column(name = "performed_at", nullable = false)
    private LocalDate performedAt;

    @Column(name = "applied_at", nullable = false)
    private LocalDateTime appliedAt;

    public AppliedMigration() {
    }

    public AppliedMigration(UUID id, String strategy, UUID oldScryfallId, UUID newScryfallId, LocalDate performedAt) {
        this.id = id;
        this.strategy = strategy;
        this.oldScryfallId = oldScryfallId;
        this.newScryfallId = newScryfallId;
        this.performedAt = performedAt;
        this.appliedAt = LocalDateTime.now();
    }

    public UUID getId() {
        return id;
    }

    public void setId(UUID id) {
        this.id = id;
    }

    public String getStrategy() {
        return strategy;
    }

    public void setStrategy(String strategy) {
        this.strategy = strategy;
    }

    public UUID getOldScryfallId() {
        return oldScryfallId;
    }

    public void setOldScryfallId(UUID oldScryfallId) {
        this.oldScryfallId = oldScryfallId;
    }

    public UUID getNewScryfallId() {
        return newScryfallId;
    }

    public void setNewScryfallId(UUID newScryfallId) {
        this.newScryfallId = newScryfallId;
    }

    public LocalDate getPerformedAt() {
        return performedAt;
    }

    public void setPerformedAt(LocalDate performedAt) {
        this.performedAt = performedAt;
    }

    public LocalDateTime getAppliedAt() {
        return appliedAt;
    }

    public void setAppliedAt(LocalDateTime appliedAt) {
        this.appliedAt = appliedAt;
    }
}
