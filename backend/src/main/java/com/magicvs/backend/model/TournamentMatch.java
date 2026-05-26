package com.magicvs.backend.model;

import jakarta.persistence.*;

import java.time.LocalDateTime;

@Entity
@Table(name = "matches")
public class TournamentMatch {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "tournament_id", nullable = false)
    private Tournament tournament;

    @Column(name = "round_number", nullable = false)
    private Integer roundNumber;

    @Column(name = "match_number", nullable = false)
    private Integer matchNumber;

    @Column(name = "player1_id")
    private Long player1Id;

    @Column(name = "player2_id")
    private Long player2Id;

    @Column(name = "winner_id")
    private Long winnerId;

    @Column(name = "reported_by_user_id")
    private Long reportedByUserId;

    @Column(name = "battle_match_id")
    private Long battleMatchId;

    @Column(name = "player1_accepted")
    private Boolean player1Accepted = false;

    @Column(name = "player2_accepted")
    private Boolean player2Accepted = false;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private MatchStatus status;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;

    @PrePersist
    protected void onCreate() {
        this.createdAt = LocalDateTime.now();
        this.updatedAt = LocalDateTime.now();
        if (this.status == null) {
            this.status = MatchStatus.PENDING;
        }
        if (this.player1Accepted == null) {
            this.player1Accepted = false;
        }
        if (this.player2Accepted == null) {
            this.player2Accepted = false;
        }
    }

    @PreUpdate
    protected void onUpdate() {
        this.updatedAt = LocalDateTime.now();
    }

    public Long getId() {
        return id;
    }

    public Tournament getTournament() {
        return tournament;
    }

    public void setTournament(Tournament tournament) {
        this.tournament = tournament;
    }

    public Integer getRoundNumber() {
        return roundNumber;
    }

    public void setRoundNumber(Integer roundNumber) {
        this.roundNumber = roundNumber;
    }

    public Integer getMatchNumber() {
        return matchNumber;
    }

    public void setMatchNumber(Integer matchNumber) {
        this.matchNumber = matchNumber;
    }

    public Long getPlayer1Id() {
        return player1Id;
    }

    public void setPlayer1Id(Long player1Id) {
        this.player1Id = player1Id;
    }

    public Long getPlayer2Id() {
        return player2Id;
    }

    public void setPlayer2Id(Long player2Id) {
        this.player2Id = player2Id;
    }

    public Long getWinnerId() {
        return winnerId;
    }

    public void setWinnerId(Long winnerId) {
        this.winnerId = winnerId;
    }

    public Long getReportedByUserId() {
        return reportedByUserId;
    }

    public void setReportedByUserId(Long reportedByUserId) {
        this.reportedByUserId = reportedByUserId;
    }

    public Long getBattleMatchId() {
        return battleMatchId;
    }

    public void setBattleMatchId(Long battleMatchId) {
        this.battleMatchId = battleMatchId;
    }

    public Boolean getPlayer1Accepted() {
        return player1Accepted;
    }

    public void setPlayer1Accepted(Boolean player1Accepted) {
        this.player1Accepted = player1Accepted;
    }

    public Boolean getPlayer2Accepted() {
        return player2Accepted;
    }

    public void setPlayer2Accepted(Boolean player2Accepted) {
        this.player2Accepted = player2Accepted;
    }

    public MatchStatus getStatus() {
        return status;
    }

    public void setStatus(MatchStatus status) {
        this.status = status;
    }

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }

    public LocalDateTime getUpdatedAt() {
        return updatedAt;
    }

    public boolean hasPlayer(Long userId) {
        return (player1Id != null && player1Id.equals(userId)) || (player2Id != null && player2Id.equals(userId));
    }
}
