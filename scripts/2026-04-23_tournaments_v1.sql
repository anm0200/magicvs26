-- Tournament V1 schema (single elimination)
-- Optional when spring.jpa.hibernate.ddl-auto=update is enabled.

CREATE TABLE IF NOT EXISTS tournaments (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    description VARCHAR(800),
    max_players INTEGER NOT NULL,
    status VARCHAR(20) NOT NULL,
    start_date TIMESTAMP NULL,
    winner_user_id BIGINT NULL,
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS tournament_participants (
    id BIGSERIAL PRIMARY KEY,
    tournament_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,
    deck_id BIGINT NOT NULL,
    joined_at TIMESTAMP NOT NULL,
    CONSTRAINT uk_tournament_participant UNIQUE (tournament_id, user_id)
);

CREATE TABLE IF NOT EXISTS matches (
    id BIGSERIAL PRIMARY KEY,
    tournament_id BIGINT NOT NULL,
    round_number INTEGER NOT NULL,
    match_number INTEGER NOT NULL,
    player1_id BIGINT NULL,
    player2_id BIGINT NULL,
    winner_id BIGINT NULL,
    reported_by_user_id BIGINT NULL,
    battle_match_id BIGINT NULL,
    player1_accepted BOOLEAN NOT NULL DEFAULT FALSE,
    player2_accepted BOOLEAN NOT NULL DEFAULT FALSE,
    status VARCHAR(20) NOT NULL,
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tournament_participants_tournament
    ON tournament_participants (tournament_id);

CREATE INDEX IF NOT EXISTS idx_matches_tournament_round
    ON matches (tournament_id, round_number, match_number);
