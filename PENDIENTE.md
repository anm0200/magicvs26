# Pendientes — Motor de Batalla (battle-engine.service.ts)

Estado actual: **4899 líneas**, `game.model.ts` **239 líneas** (5ª revisión)

---

## Implementado

### Palabras clave de criatura (15)
`hasAbility()` reconoce: haste, vigilance, lifelink, deathtouch, trample, indestructible, flying, reach, first strike, double strike, unblockable, menace, ward, defender, hexproof, shroud, protection, flash, decayed

### Efectos parseados por `parseCardEffect()` (~35)
ATTACH_AURA, BUFF_TEMP, INCUBATE, CONNIVE, DISCOVER, ETB_COUNTERS, ETB_TAPPED, DRAW, DAMAGE, LIFE_CHANGE, EXILE, DESTROY, BOUNCE, SELF_BUFF_TEMP, CREATE_TOKEN, MILL, COUNTER_SPELL, COPY_SPELL, TUTOR, TRANSFORM, SCRY, SURVEIL, FIGHT, SACRIFICE_TARGET_PLAYER, SACRIFICE, EXILE_FROM_GRAVEYARD, RETURN_FROM_GRAVEYARD, BOUNCE_PERMANENT, DESTROY_ART_ENC, DAMAGE_EACH_CREATURE, CANT_BE_BLOCKED_TEMP

### Mecánicas complejas
Adventure, Disturb, MDFC (Modal DFC), Daybound/Nightbound, Incubate, Connive, Discover/Cascade, Landfall, Poison Counters/Infect/Toxic, Decayed, Boast, Training, Pack Tactics, Kicker, Flashback, Escape, Cycling, Channel, Convoke, Sacrifice as additional cost, Fight, Sweeper, Transform, Scry, Surveil, Mill, Tutor, Counter Spell, Copy Spell, Exile, Bounce, Sagas, Planeswalkers, Battles, Equipment, Auras, Vehicles/Crew, Multi-block ordering, Lord effects, Delirium, Threshold, Hellbent

---

## Pendiente de implementar

### Prioridad Alta
| Mecánica | Dónde empiezar | Descripción |
|---|---|---|
| **Bestow** | `playCard` / `parseCardEffect` | Cartas que se lanzan como Aura o criatura. Similar a Adventure pero con Aura en campo. Buscar "bestow" / "otorgar" en oracleText. |

### Prioridad Media
| Mecánica | Descripción |
|---|---|
| **Foretell / Plot** | Exilar boca abajo pagando {2}, lanzar después en otro turno por coste reducido |
| **Blood Tokens** | Crear ficha de artefacto Blood {1},{T},{descarta una carta, roba una carta} |
| **Exploit** | "When this creature enters, you may sacrifice a creature." Efecto ETB con sacrificio opcional |

### Prioridad Baja
| Mecánica | Descripción |
|---|---|
| **Escalate** | Pagar coste adicional por modos adicionales |
| **Reconfigure** | Equipment que puede ser criatura y equiparse/desequiparse |
| **Kicker multi-modo** | Actualmente duplica valor numérico; algunos kicks tienen efectos cualitativamente diferentes |

---

## Mejoras / Bugs detectados

- [ ] `parseCardEffect` para **Bestow**: detectar "bestow" / "otorgar" en el texto y ofrecer opción al jugador
- [ ] **Infect** solo está implementado en daño de combate directo, no en hechizos
- [ ] `checkDelirium`/`checkThreshold`/`checkHellbent` están definidos pero no se usan activamente en `getModifiedPower` ni en parseCardEffect
- [ ] Trample en `fight()` (línea 3540) usa `bt` (toughness original) en vez de remaining toughness
- [ ] La IA (Bot) para Scry/Surveil es muy básica — podría mejorarse
- [ ] `cancelPayment()` recarga del servidor en vez de revertir localmente

---

## Archivos clave

- `frontend/src/app/core/services/battle-engine.service.ts` — motor de juego (4,899 líneas)
- `frontend/src/app/models/game.model.ts` — interfaces GameState, GameCard, etc. (239 líneas)
