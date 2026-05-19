import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, interval, Subscription } from 'rxjs';
import { GameState, GamePhase, GameCard, PlayerGameState, ManaPool, AnimationStatus, StackItem } from '../../models/game.model';
import { BattleService } from './battle.service';
import { NotificationService } from './notification.service';
import { UserService } from './user.service';

@Injectable({
  providedIn: 'root'
})
export class BattleEngineService {
  private gameStateSubject = new BehaviorSubject<GameState | null>(null);
  public gameState$ = this.gameStateSubject.asObservable();
  private pollSubscription: Subscription | null = null;
  private isProcessing = false;
  private selectedBlockerId: string | null = null;
  private syncInterval: any;
  private kickedNextCast = false;
  private additionalCostPaidMap = new Map<string, boolean>();

  constructor(
    private battleService: BattleService,
    private userService: UserService,
    private notificationService: NotificationService
  ) {}

  /**
   * Helper to get the local player state
   */
  public me(): PlayerGameState | null {
    const state = this.gameStateSubject.value;
    if (!state) return null;
    const myId = this.userService.getCurrentUser()?.id?.toString();
    return state.player1.id === myId ? state.player1 : state.player2;
  }

  /**
   * Helper to get the opponent player state
   */
  public opponent(): PlayerGameState | null {
    const state = this.gameStateSubject.value;
    if (!state) return null;
    const myId = this.userService.getCurrentUser()?.id?.toString();
    return state.player1.id === myId ? state.player2 : state.player1;
  }

  /**
   * Initializes the local state machine with data from backend
   */
  initialize(initialState: GameState): void {
    if (!initialState) return;
    const state = JSON.parse(JSON.stringify(initialState)); 
    const myId = this.userService.getCurrentUser()?.id?.toString() || '';
    
    const isP1Me = state.player1.id === myId;
    const me = isP1Me ? state.player1 : state.player2;

    if (me.hand.length === 0 && state.currentPhase === GamePhase.UNTAP) {
      [state.player1, state.player2].forEach(p => {
        const allCards = [...p.library, ...p.hand, ...p.field];
        p.library = allCards;
        p.hand = [];
        p.field = [];
        p.libraryCount = allCards.length;
        p.handCount = 0;
        p.mulliganCount = 0;
        p.isReady = false;
        p.manaPool = this.createEmptyManaPool();
      });
      if (!state.activePlayerId) {
        state.activePlayerId = state.player1.id;
      }
      state.currentPhase = GamePhase.MULLIGAN_DECIDING;
      state.turnCount = 1;
    }

    state.animationStatus = 'IDLE';
    state.landsPlayedThisTurn = state.landsPlayedThisTurn || 0;
    
    // Ensure stack and priority fields exist
    state.stack = state.stack || [];
    state.passedCount = state.passedCount || 0;
    state.priorityPlayerId = state.priorityPlayerId || state.activePlayerId;

    this.gameStateSubject.next(state);
    this.startPolling(state.matchId);
  }

  private startPolling(matchId: string): void {
    if (this.pollSubscription) this.pollSubscription.unsubscribe();
    
    this.pollSubscription = interval(1000).subscribe(() => {
      this.pollState(matchId);
    });
  }

  private pollState(matchId: string): void {
    const state = this.gameStateSubject.value;
    if (!state || this.isProcessing) return;

    this.battleService.getBattleState(matchId).subscribe({
      next: (remoteState) => {
        if (!this.isProcessing) {
          this.gameStateSubject.next(remoteState);
        }
      }
    });
  }

  stopPolling(): void {
    this.pollSubscription?.unsubscribe();
  }

  concede(): void {
    const state = this.gameStateSubject.value;
    if (!state) return;
    const myId = this.userService.getCurrentUser()?.id?.toString();
    
    this.battleService.processAction(state.matchId, {
      type: 'CONCEDE',
      playerId: myId,
      payload: {}
    }).subscribe(newState => {
      this.gameStateSubject.next(newState);
    });
  }

  async startGame(): Promise<void> {
    const state = this.gameStateSubject.value;
    if (!state) return;
    const myId = this.userService.getCurrentUser()?.id?.toString();

    // LEAD PLAYER LOGIC
    if (state.player1.id != myId || state.currentPhase !== GamePhase.UNTAP || state.animationStatus !== 'IDLE' || this.isProcessing) {
       return;
    }

    try {
      this.isProcessing = true;
      this.updateState({ animationStatus: 'SHUFFLING' as AnimationStatus }, true);
      this.shuffle(state.player1.library);
      this.shuffle(state.player2.library);
      await this.delay(2000);

      let finalState = { ...state };
      if (state.player1.hand.length === 0) {
        let currentState = { ...state, animationStatus: 'DEALING' as AnimationStatus };
        this.gameStateSubject.next(currentState);
        
        for (let i = 0; i < 7; i++) {
          currentState = this.drawCard(currentState, currentState.player1.id);
          currentState = this.drawCard(currentState, currentState.player2.id);
          this.gameStateSubject.next(currentState);
          await this.delay(300);
        }
        finalState = currentState;
      }

      this.updateState({ ...finalState, animationStatus: 'IDLE' as AnimationStatus, currentPhase: GamePhase.MULLIGAN_DECIDING }, true);
    } catch (error) {
      console.error('Error starting game:', error);
      this.updateState({ animationStatus: 'IDLE' }, true);
    } finally {
      this.isProcessing = false;
    }
  }

  async takeMulligan(): Promise<void> {
    const p = this.me();
    if (!p) return;

    this.isProcessing = true;
    p.mulliganCount++;
    p.library.push(...p.hand);
    p.hand = [];
    p.handCount = 0;
    this.shuffle(p.library);
    p.libraryCount = p.library.length;
    p.isReady = false;

    const state = this.gameStateSubject.value;
    if (!state) {
      this.isProcessing = false;
      return;
    }
    let currentState = { ...state, animationStatus: 'DEALING' as AnimationStatus };
    this.gameStateSubject.next(currentState);

    for (let i = 0; i < 7; i++) {
      currentState = this.drawCard(currentState, p.id);
      this.gameStateSubject.next(currentState);
      await this.delay(300);
    }
    
    this.isProcessing = false;
    this.updateState({ ...currentState, animationStatus: 'IDLE' as AnimationStatus, currentPhase: GamePhase.MULLIGAN_DECIDING }, true);
  }

  keepHand(): void {
    const p = this.me();
    if (!p) return;

    if (p.mulliganCount === 0) {
      p.isReady = true;
      this.checkMulliganCompletion();
    } else {
      this.updateState({ currentPhase: GamePhase.MULLIGAN });
    }
  }

  dropCardToBottom(cardId: string): void {
    const p = this.me();
    if (!p) return;

    const cardIndex = p.hand.findIndex(c => c.id === cardId);
    if (cardIndex !== -1) {
      const card = p.hand.splice(cardIndex, 1)[0];
      p.library.push(card); 
      p.libraryCount = p.library.length;
      p.handCount = p.hand.length;

      const cardsToDrop = p.mulliganCount;
      if (p.hand.length === (7 - cardsToDrop)) {
        p.isReady = true;
        this.checkMulliganCompletion();
      } else {
        this.updateState({});
      }
    }
  }

  private checkMulliganCompletion(): void {
    const state = this.gameStateSubject.value;
    if (!state) return;

    if (state.player1.isReady && state.player2.isReady) {
      // Start the very first turn in MAIN 1
      this.updateState({ 
        currentPhase: GamePhase.MAIN_1,
        priorityPlayerId: state.activePlayerId,
        passedCount: 0
      });
      this.isProcessing = false;
    } else {
      this.updateState({}); 
    }
  }

  nextPhase(): void {
    const state = this.gameStateSubject.value;
    if (!state || (state.pendingBlockerOrders?.length || 0) > 0) return;

    if (state.stack.length > 0) {
      this.notificationService.showToast('La pila no está vacía', 'Debes esperar a que se resuelvan todos los efectos.', 'WARNING');
      return;
    }

    this.isProcessing = true;

    const phases = Object.values(GamePhase);
    const currentIndex = phases.indexOf(state.currentPhase);
    let nextIndex = currentIndex + 1;

    // Handle Combat Resolution if leaving COMBAT phase
    if (state.currentPhase === GamePhase.COMBAT) {
      const paused = this.resolveCombat();
      if (paused) {
        this.isProcessing = false;
        return;
      }
    }

    // Cleanup check: Cannot leave END phase with > 7 cards
    if (state.currentPhase === GamePhase.END) {
      const activePlayer = state.activePlayerId === state.player1.id ? state.player1 : state.player2;
      if (activePlayer.hand.length > 7) {
        this.notificationService.showToast('Límite de mano', `El jugador activo (${activePlayer.username}) debe descartar hasta tener 7.`, 'WARNING');
        this.isProcessing = false;
        return;
      }
    }

    if (nextIndex >= phases.length) {
      this.rotateTurn();
    } else {
      const nextPhase = phases[nextIndex] as GamePhase;

      let newState = { ...state };
      newState.currentPhase = nextPhase;

      // Reset combat states when leaving combat
      if (nextPhase === GamePhase.MAIN_2 || nextPhase === GamePhase.END) {
        [newState.player1, newState.player2].forEach(p => {
          p.field = p.field.map(c => ({
            ...c,
            isAttacking: false,
            isBlocking: false,
            blockingTargetId: undefined
          }));
        });
      }
      
      // Clear mana
      newState.player1 = { ...newState.player1, manaPool: this.createEmptyManaPool() };
      newState.player2 = { ...newState.player2, manaPool: this.createEmptyManaPool() };

      // Priority resets to Active Player on phase change
      newState.priorityPlayerId = newState.activePlayerId;
      newState.passedCount = 0;

      // Automatic actions
      newState = this.processAutomaticPhaseActions(newState, nextPhase);

      this.updateState(newState, true, () => {
        this.isProcessing = false;
      });
    }
  }

  forceNextPhase(): void {
    const state = this.gameStateSubject.value;
    if (!state || (state.pendingBlockerOrders?.length || 0) > 0) return;
    
    const myId = this.userService.getCurrentUser()?.id?.toString();
    if (state.activePlayerId !== myId) {
      this.notificationService.showToast('Acción no permitida', 'Solo el jugador activo puede forzar el cambio de fase.', 'ERROR');
      return;
    }
    this.notificationService.showToast('Forzando fase', 'Saltando validaciones...', 'INFO');
    this.isProcessing = false;
    this.nextPhase();
  }

  public getIsProcessing(): boolean {
    return this.isProcessing;
  }

  passPriority(): void {
    const state = this.gameStateSubject.value;
    if (!state || this.isProcessing) return;

    const myId = this.userService.getCurrentUser()?.id?.toString();
    const currentPriorityId = state.priorityPlayerId || state.activePlayerId;

    if (currentPriorityId !== myId) {
      this.notificationService.showToast('No tienes la prioridad', 'Debes esperar a que el rival pase prioridad.', 'WARNING');
      return;
    }

    console.log(`Priority Action: ${myId} is passing. Stack size: ${state.stack.length}, Current Passes: ${state.passedCount}`);
    this.isProcessing = true;
    const nextPriorityPlayerId = currentPriorityId === state.player1.id ? state.player2.id : state.player1.id;
    
    const newPassedCount = (state.passedCount || 0) + 1;

    if (newPassedCount >= 2) {
      // Rule: Cannot leave END phase with > 7 cards
      if (state.currentPhase === GamePhase.END) {
        const activePlayer = state.activePlayerId === state.player1.id ? state.player1 : state.player2;
        if (activePlayer.hand.length > 7) {
          const currentUserId = this.userService.getCurrentUser()?.id?.toString();
          if (state.activePlayerId === currentUserId) {
            this.notificationService.showToast('Límite de mano', 'Debes descartar cartas hasta tener 7 antes de terminar tu turno.', 'WARNING');
          } else {
            this.notificationService.showToast('Esperando descarte', `El rival (${activePlayer.username}) debe descartar cartas.`, 'INFO');
          }
          this.isProcessing = false;
          // Reset passes so they must pass again after discard
          this.updateState({ passedCount: 0 }, true);
          return;
        }
      }

      console.log("-> Ambos han pasado. Resolviendo...");
      if (state.stack.length > 0) {
        this.resolveTopStackItem(state);
      } else {
        this.nextPhase();
      }
    } else {
      console.log(`-> Un pase registrado. Prioridad para: ${nextPriorityPlayerId}`);
      
      // SPRINT 14: Trigger Attack Skills (Training, Pack Tactics)
      if (state.currentPhase === GamePhase.COMBAT && currentPriorityId === state.activePlayerId) {
         this.evaluateAttackTriggers(state);
      }

      this.updateState({ 
        priorityPlayerId: nextPriorityPlayerId,
        passedCount: newPassedCount
      }, true, () => {
        this.isProcessing = false;
      });
    }
  }

  private resolveTopStackItem(state: GameState): void {
    const stack = [...state.stack];
    const item = stack.pop();
    if (!item) return;

    state.stack = stack;
    this.notificationService.showToast('Resolviendo', `Se resuelve: ${item.name}`, 'INFO');
    
    // Reset priority to active player after resolution (Standard MTG rule)
    state.priorityPlayerId = state.activePlayerId;
    state.passedCount = 0; // Everyone must pass again

    // Execute effect
    this.applyResolvedEffect(item, state);

    // Check Saga sacrifices (Sprint 10)
    this.checkSagaSacrifices(state);

    this.updateState(state, true, () => {
      this.isProcessing = false;
    });
  }

  private applyResolvedEffect(item: StackItem, state: GameState): void {
    const controller = item.controllerId === state.player1.id ? state.player1 : state.player2;
    
    // Move card to final destination
    if (item.card) {
      const card = item.card;
      
      if (card.castAsAdventure) {
        card.adventureExiled = true;
        card.castAsAdventure = false; // Reset flag
        controller.exile = controller.exile || [];
        controller.exile.push(card);
        controller.exileCount = controller.exile.length;
        console.log(`🌀 Aventura ${card.name} se exilia al resolverse ("En una aventura").`);
        
        // Execute the adventure's instant/sorcery effect!
        const effect = this.parseCardEffect(card, card.adventureOracleText);
        if (effect) {
          if (effect.needsTarget && !item.targetId) {
            state.pendingTarget = {
              sourceCardId: card.id,
              validTargets: effect.validTargets,
              effect: effect.effect,
              value: effect.value
            };
            this.notificationService.showToast('Efecto de Aventura', 'Selecciona un objetivo para el efecto de la aventura.', 'INFO');
          } else {
            this.executeNonTargetEffect(effect, controller, false, card.id, state);
          }
        }
      } else if (card.exileOnResolution) {
        controller.exile = controller.exile || [];
        controller.exile.push(card);
        controller.exileCount = controller.exile.length;
        console.log(`🌀 Hechizo ${card.name} se exilia al resolverse (Flashback/Escape).`);
      } else if (card.type?.toLowerCase().includes('instant') || card.type?.toLowerCase().includes('sorcery') || 
          card.type?.toLowerCase().includes('instantáneo') || card.type?.toLowerCase().includes('conjuro')) {
        controller.graveyard.push(card);
        controller.graveyardCount = controller.graveyard.length;
      } else {
        // --- SPRINT 11: Día/Noche Entrada al Campo ---
        const cText = (card.oracleText || '').toLowerCase();
        const hasDaybound = cText.includes('daybound') || cText.includes('diurno');
        if (hasDaybound) {
          if (!state.timeCycle || state.timeCycle === 'NONE') {
            state.timeCycle = 'DAY';
            this.notificationService.showToast('Ciclo Día/Noche', 'El juego entra en ciclo de DÍA.', 'INFO');
          }
          if (state.timeCycle === 'NIGHT') {
            this.transformCardFace(card, 1); // Transform to Nightbound face
          }
        }

        card.enteredFieldTurn = state.turnCount;
        this.processETBEffects(card, controller, state);
        controller.field.push(card);

        // --- SPRINT 11: Landfall Triggers ---
        if (card.type?.toLowerCase().includes('land') || card.type?.toLowerCase().includes('tierra')) {
          this.checkLandfallTriggers(controller, state);
        }
      }
    }
    
    // Apply specific effect logic
    if (item.targetId) {
       this.executeTargetEffectLogic(item, state);
    } else if (item.effect) {
       const effect = item.effect;
       if (effect.needsTarget && !item.targetId) {
         // This was an ETB that needs a target but hasn't been chosen yet
         state.pendingTarget = {
           sourceCardId: item.sourceCardId,
           validTargets: effect.validTargets,
           effect: effect.effect,
           value: effect.value
         };
         this.notificationService.showToast('Efecto de entrada', 'Selecciona un objetivo para la habilidad.', 'INFO');
       } else {
         this.executeNonTargetEffect(effect, controller, item.kicked, item.sourceCardId, state);
       }
    }
  }



  private processAutomaticPhaseActions(state: GameState, phase: GamePhase): GameState {
    let newState = { ...state };
    if (phase === GamePhase.UNTAP) {
      const prevPlayerId = newState.activePlayerId === newState.player1.id ? newState.player2.id : newState.player1.id;
      this.processDayNightCycle(newState, prevPlayerId);

      newState = this.untapEverything(newState, newState.activePlayerId);
      newState = this.resetCombatStatus(newState);
    } else if (phase === GamePhase.DRAW) {
      newState = this.drawCard(newState, newState.activePlayerId);
    } else if (phase === GamePhase.MAIN_1) {
      newState = this.processSagasTurnStart(newState, newState.activePlayerId);
    } else if (phase === GamePhase.END) {
      newState = this.resetCombatStatus(newState);
    }
    return newState;
  }

  private resetCombatStatus(state: GameState): GameState {
    const reset = (p: PlayerGameState) => {
      p.field = p.field.map(c => ({ ...c, isAttacking: false, isBlocking: false }));
    };
    reset(state.player1);
    reset(state.player2);
    return state;
  }

  private untapEverything(state: GameState, playerId: string): GameState {
    const isP1 = state.player1.id === playerId;
    
    // The active player's cards untap, but BOTH players' cards heal (cleanup step happens right before this, but doing it here works)
    const updatedPlayer1 = {
      ...state.player1,
      field: state.player1.field.map(c => ({
        ...c,
        isTapped: isP1 ? false : c.isTapped,
        damageTaken: 0,
        crewed: false,
        tempUnblockable: false,
        loyaltyUsedThisTurn: isP1 ? false : c.loyaltyUsedThisTurn
      }))
    };
    
    const updatedPlayer2 = {
      ...state.player2,
      field: state.player2.field.map(c => ({
        ...c,
        isTapped: !isP1 ? false : c.isTapped,
        damageTaken: 0,
        crewed: false,
        tempUnblockable: false,
        loyaltyUsedThisTurn: !isP1 ? false : c.loyaltyUsedThisTurn
      }))
    };

    return {
      ...state,
      player1: updatedPlayer1,
      player2: updatedPlayer2
    };
  }

  private drawCard(state: GameState, playerId: string): GameState {
    const isP1 = state.player1.id === playerId;
    const p = isP1 ? state.player1 : state.player2;

    if (p.library.length > 0) {
      const library = [...p.library];
      const hand = [...p.hand];
      const card = library.shift()!;
      hand.push(card);
      
      const updatedPlayer = {
        ...p,
        library: library,
        hand: hand,
        libraryCount: library.length,
        handCount: hand.length
      };
      
      return {
        ...state,
        [isP1 ? 'player1' : 'player2']: updatedPlayer
      };
    }
    return state;
  }

  private rotateTurn(): void {
    const state = this.gameStateSubject.value;
    if (!state) return;

    let newState = { ...state };
    const nextPlayerId = state.activePlayerId === state.player1.id ? state.player2.id : state.player1.id;
    newState.activePlayerId = nextPlayerId;
    newState.currentPhase = GamePhase.UNTAP;
    newState.landsPlayedThisTurn = 0;
    newState.turnCount = state.activePlayerId === state.player2.id ? state.turnCount + 1 : state.turnCount;
    
    // Limpieza de modificadores temporales y daño al finalizar el turno
    [newState.player1, newState.player2].forEach(player => {
      player.manaPool = this.createEmptyManaPool();
      player.field = player.field.map(c => ({
        ...c,
        tempPowerModifier: 0,
        tempToughnessModifier: 0,
        damageTaken: 0,
        hasAttackedThisTurn: false,
        boastActivatedThisTurn: false
      }));
    });
    
    // Priority resets to the player whose turn it is
    newState.priorityPlayerId = nextPlayerId;
    newState.passedCount = 0;

    // Untap everything for the new player
    newState = this.untapEverything(newState, nextPlayerId);

    this.gameStateSubject.next(newState);
    this.battleService.pushState(newState.matchId, newState).subscribe({
      next: () => { this.isProcessing = false; },
      error: () => { this.isProcessing = false; }
    });
  }

  playCard(cardId: string): void {
    const state = this.gameStateSubject.value;
    if (!state || this.isProcessing || state.pendingManaChoice || (state.pendingPayment && !state.pendingPayment.convokeActive)) return;
    this.isProcessing = true;

    const p = this.me();
    if (!p) {
      this.isProcessing = false;
      return;
    }

    const cardIndex = p.hand.findIndex(c => c.id === cardId);
    if (cardIndex === -1) {
      this.isProcessing = false;
      return;
    }
    const card = p.hand[cardIndex];
    const isFast = this.isFastCard(card);

    // --- SPRINT 12: INTERCEPCIÓN DE MDFC (MODAL DFC) ---
    if (card.isMdfc && card.mdfcFaceSelected === undefined) {
      state.pendingMdfcChoice = {
        cardId: card.id,
        face0Name: card.name,
        face1Name: card.adventureName || `${card.name} (Reverso)`,
        face0Cost: card.manaCost || [],
        face1Cost: card.adventureManaCost || [],
        face0Type: card.type || 'Spell',
        face1Type: card.adventureType || 'Land'
      };
      this.gameStateSubject.next({ ...state });
      this.isProcessing = false;
      return;
    }

    // --- SPRINT 11: INTERCEPCIÓN DE AVENTURA (ADVENTURE) ---
    if (card.isAdventure && !card.castAsAdventure && !this.adventureChoicePassedSet.has(card.id)) {
      state.pendingAdventureChoice = {
        cardId: card.id,
        creatureCost: card.manaCost || [],
        adventureCost: card.adventureManaCost || [],
        adventureName: card.adventureName || 'Aventura'
      };
      this.gameStateSubject.next({ ...state });
      this.isProcessing = false;
      return;
    }
    this.adventureChoicePassedSet.delete(card.id);

    // --- SPRINT 15: INTERCEPCIÓN DE CONCESIÓN (BESTOW) ---
    if (this.hasBestow(card) && !card.castAsBestow && !this.bestowChoicePassedSet.has(card.id)) {
      const bestowCost = this.parseBestowCost(card);
      const allCreatures = [...state.player1.field, ...state.player2.field].filter(c => 
        ((c.type || '').toLowerCase().includes('creature') || (c.type || '').toLowerCase().includes('criatura') || !!c.crewed) && !c.attachedToCardId
      );
      if (allCreatures.length > 0) {
        state.pendingBestowChoice = {
          cardId: card.id,
          creatureCost: card.manaCost || [],
          bestowCost: bestowCost,
          bestowName: card.name
        };
        this.gameStateSubject.next({ ...state });
        this.isProcessing = false;
        return;
      }
    }
    this.bestowChoicePassedSet.delete(card.id);
    
    // --- SPRINT 7: INTERCEPCIÓN DE COSTE ADICIONAL (SACRIFICIO) ---
    const text = (card.oracleText || '').toLowerCase();

    // --- SPRINT 9: INTERCEPCIÓN DE CANALIZAR (CHANNEL) ---
    const hasChannel = text.includes('channel —') || text.includes('canalizar —') || text.includes('channel -') || text.includes('canalizar -');
    if (hasChannel && !state.pendingChannelChoice && !this.channelChoicePassedSet.has(card.id)) {
      const channelCost = this.parseChannelCost(card);
      state.pendingChannelChoice = {
        cardId: card.id,
        channelCost: channelCost
      };
      this.gameStateSubject.next({ ...state });
      this.isProcessing = false;
      return;
    }
    this.channelChoicePassedSet.delete(card.id);

    const needsSacToCast = text.includes("as an additional cost") && (text.includes("sacrifice") || text.includes("sacrifica"));
    if (needsSacToCast && !state.pendingSacrificeChoice && !this.additionalCostPaidMap.has(card.id)) {
      const validCards = p.field.filter(c => {
        if (text.includes("sacrifice a creature") || text.includes("sacrifica una criatura")) {
          return !c.type?.toLowerCase().includes('land');
        }
        return true;
      });

      if (validCards.length === 0) {
        this.notificationService.showToast('Acción inválida', `No tienes permanentes válidos para sacrificar como coste de "${card.name}".`, 'WARNING');
        this.isProcessing = false;
        return;
      }

      state.pendingSacrificeChoice = {
        playerId: p.id,
        count: 1,
        validTypes: (text.includes("sacrifice a creature") || text.includes("sacrifica una criatura")) ? 'CREATURE' : 'PERMANENT',
        sourceCardId: card.id
      };
      this.notificationService.showToast('Coste adicional', 'Debes seleccionar un permanente para sacrificar como coste adicional.', 'INFO');
      this.gameStateSubject.next({ ...state });
      this.isProcessing = false;
      return;
    }
    
    const myId = this.userService.getCurrentUser()?.id?.toString();
    if (state?.activePlayerId !== myId && !isFast) {
      this.notificationService.showToast('Acción inválida', 'Solo puedes jugar Instantáneos o cartas con Destello fuera de tu turno.', 'WARNING');
      this.isProcessing = false;
      return;
    }

    const isMainPhase = state.currentPhase === GamePhase.MAIN_1 || state.currentPhase === GamePhase.MAIN_2;
    if (!isMainPhase && !isFast) {
      this.notificationService.showToast('Fase incorrecta', 'Solo puedes jugar esta carta en tus fases principales.', 'WARNING');
      this.isProcessing = false;
      return;
    }

    // Interceptar Kicker (Estímulo)
    const kickerCost = this.parseKickerCost(card);
    if (kickerCost.length > 0 && !state.pendingKickerChoice) {
      state.pendingKickerChoice = {
        cardId: card.id,
        kickerCost: kickerCost
      };
      this.gameStateSubject.next({ ...state });
      this.isProcessing = false;
      return;
    }

    const isLand = card.type?.toLowerCase().includes('land') || card.type?.toLowerCase().includes('tierra');

      if (isLand) {
        if (state.landsPlayedThisTurn >= 1) {
          this.notificationService.showToast('Acción bloqueada', 'Ya has bajado una tierra este turno.', 'WARNING');
          this.isProcessing = false;
          return;
        }
        
        // Play land immediately
        p.hand.splice(cardIndex, 1);
        this.processETBEffects(card, p, state);
        p.field.push(card);
        this.checkLandfallTriggers(p, state);
          return;
        } else if (isConvoke) {
          const totalCost = costReq.generic + costReq.white + costReq.blue + costReq.black + costReq.red + costReq.green;
          if (totalManaAvailable + convokeAllowance < totalCost) {
            this.notificationService.showToast('Falta maná/criaturas', `No tienes suficiente maná y criaturas para convocar "${card.name}".`, 'WARNING');
            this.isProcessing = false;
            return;
          }
        }

        if (isConvoke && convokeAllowance > 0) {
          const totalCost = costReq.generic + costReq.white + costReq.blue + costReq.black + costReq.red + costReq.green;
          state.pendingPayment = {
            cardId: cardId,
            remainingGeneric: totalCost,
            specificPaid: true,
            convokeActive: true,
            tappedConvokeCreatureIds: []
          };
          this.notificationService.showToast('Convocar Hechizo', 'Gira criaturas o paga maná para reducir el coste.', 'INFO');
          this.gameStateSubject.next({ ...state });
          return;
        }

        // Subtract specific costs first
        this.paySpecificCosts(costReq, p.manaPool);

        const totalAvailable = Object.values(p.manaPool).reduce((a, b) => a + b, 0);
        
        if (costReq.generic === 0) {
          // No generic cost, proceed
          this.finishPlayingCard(cardId);
        } else if (totalAvailable === costReq.generic) {
          // Exactly enough mana, auto-pay all and proceed
          this.autoPayGenericInternal(p.manaPool, costReq.generic);
          this.finishPlayingCard(cardId);
        } else {
          // Ambiguity! Show payment UI
          state.pendingPayment = {
            cardId: cardId,
            remainingGeneric: costReq.generic,
            specificPaid: true
          };
          this.gameStateSubject.next({ ...state });
          // Keep isProcessing = true to block polling while payment UI is open
        }
    }
  }

  private finishPlayingCard(cardId: string): void {
    const state = this.gameStateSubject.value;
    const p = this.me();
    if (!state || !p) return;

    const cardIndex = p.hand.findIndex(c => c.id === cardId);
    if (cardIndex !== -1) {
      const card = p.hand[cardIndex];
      const effect = this.parseCardEffect(card, card.castAsAdventure ? card.adventureOracleText : undefined);
      this.additionalCostPaidMap.delete(cardId);

      const isSpell = this.isSpell(card) || !!card.castAsAdventure;

      // Incrementar hechizos lanzados para el ciclo Día/Noche
      if (isSpell) {
        state.spellsCastThisTurn = state.spellsCastThisTurn || {};
        state.spellsCastThisTurn[p.id] = (state.spellsCastThisTurn[p.id] || 0) + 1;
      }

      // Handle targeting if needed (Only for Spells at casting time)
      if (isSpell && effect && effect.needsTarget && !state.pendingTarget) {
        state.pendingTarget = {
          sourceCardId: card.id,
          validTargets: effect.validTargets,
          effect: effect.effect,
          value: effect.value
        };
        this.notificationService.showToast('Selecciona objetivo', `Elige un objetivo para ${card.castAsAdventure ? (card.adventureName || card.name) : card.name}`, 'INFO');
        this.gameStateSubject.next({ ...state });
        this.isProcessing = false;
        return;
      }

      // Create Stack Item
      const stackItem: StackItem = {
        id: Math.random().toString(36).substr(2, 9),
        sourceCardId: card.id,
        controllerId: p.id,
        type: 'SPELL',
        name: card.castAsAdventure ? (card.adventureName || card.name) : card.name,
        card: { ...card },
        imageUrl: card.imageUrl,
        effect: effect,
        kicked: this.kickedNextCast,
        targetId: state.pendingTarget?.sourceCardId === card.id ? this.selectedTargetId : undefined,
        targetType: state.pendingTarget?.sourceCardId === card.id ? this.selectedTargetType : undefined
      };

      if (card.castAsAdventure && stackItem.card) {
        stackItem.card.name = card.adventureName || card.name;
        stackItem.card.manaCost = card.adventureManaCost || [];
        stackItem.card.type = card.adventureType || 'Sorcery';
        stackItem.card.oracleText = card.adventureOracleText || '';
      }

      this.kickedNextCast = false; // Reset kicker choice state

      // Remove from hand immediately
      p.hand.splice(cardIndex, 1);
      p.handCount = p.hand.length;

      // Resolve immediately (Sandbox Mode)
      // this.applyResolvedEffect(stackItem, state);
      
      // Add to stack
      const newStack = [...state.stack, stackItem];
      
      // Cleanup pending states
      state.pendingPayment = undefined;
      state.pendingTarget = undefined;
      
      // After playing something, priority remains with the player who played it
      // but everyone else must pass again to resolve it.

      // --- SPRINT 13: CASCADE TRIGGER ---
      if (this.hasAbility(card, 'cascade') || this.hasAbility(card, 'cascada')) {
         const cmc = this.calculateManaValue(card);
         this.startDiscover(p.id, cmc, true);
      }

      this.updateState({ 
        stack: newStack,
        passedCount: 0 
      }, true, () => {
        this.isProcessing = false;
      });
    }
  }

  private selectedTargetId?: string;
  private selectedTargetType?: 'CREATURE' | 'PLAYER' | 'SPELL_ON_STACK';

  private executeTargetEffectLogic(item: StackItem, state: GameState): void {
    const targetType = item.targetType;
    const targetId = item.targetId;
    const effect = item.effect?.effect;
    
    // Multiplicador por Estímulo (Kicker)
    const kicked = item.kicked || false;
    const mult = kicked ? 2 : 1;
    const value = (item.effect?.value || 0) * mult;

    if (!targetId || !targetType) return;

    if (targetType === 'PLAYER') {
      const targetPlayer = state.player1.id === targetId ? state.player1 : state.player2;
      if (effect === 'DAMAGE') {
        targetPlayer.hp -= value;
      } else if (effect === 'LIFE_CHANGE') {
        targetPlayer.hp += value;
      } else if (effect === 'MILL') {
        const count = Math.min(value, targetPlayer.library.length);
        for (let i = 0; i < count; i++) {
          const milled = targetPlayer.library.shift();
          if (milled) {
            targetPlayer.graveyard.push(milled);
          }
        }
        targetPlayer.graveyardCount = targetPlayer.graveyard.length;
        targetPlayer.libraryCount = targetPlayer.library.length;
        this.notificationService.showToast('Fresado (Mill)', `${targetPlayer.username} ha fresado (descartado de la biblioteca) ${count} cartas.`, 'SUCCESS');
      } else if (effect === 'SACRIFICE_TARGET_PLAYER') {
        state.pendingSacrificeChoice = {
          playerId: targetPlayer.id,
          count: 1,
          validTypes: 'CREATURE'
        };
        this.notificationService.showToast('Sacrificio forzado', `${targetPlayer.username} debe sacrificar una criatura.`, 'WARNING');
        this.checkAutomatedSacrifice();
      } else if (effect === 'EXILE_FROM_GRAVEYARD') {
        state.pendingGraveyardSelection = {
          playerId: targetPlayer.id,
          effectType: 'EXILE',
          sourceCardId: item.sourceCardId
        };
        this.notificationService.showToast('Selección del cementerio', `Abre el cementerio de ${targetPlayer.username} para exiliar una carta.`, 'INFO');
        this.checkAutomatedGraveyardSelection();
      }
    } else if (targetType === 'SPELL_ON_STACK') {
      if (effect === 'COUNTER_SPELL') {
        const targetStackItem = state.stack.find(s => s.id === targetId);
        if (targetStackItem && targetStackItem.card) {
          const text = (targetStackItem.card.oracleText || '').toLowerCase();
          const immune = text.includes("can't be countered") || text.includes("no puede ser contrarrestado") || text.includes("no puede ser contrarrestada");
          if (immune) {
            this.notificationService.showToast('Contrarrestar fallido', `"${targetStackItem.card.name}" no puede ser contrarrestado de forma alguna.`, 'WARNING');
          } else {
            this.notificationService.showToast('Contrarrestado', `"${targetStackItem.card.name}" ha sido contrarrestado con éxito.`, 'SUCCESS');
            const targetController = targetStackItem.controllerId === state.player1.id ? state.player1 : state.player2;
            if (targetStackItem.card.disturbExileOnLeave) {
              targetStackItem.card.disturbExileOnLeave = false;
              targetStackItem.card.currentFaceIndex = 0;
              targetController.exile = targetController.exile || [];
              targetController.exile.push(targetStackItem.card);
              targetController.exileCount = targetController.exile.length;
              this.notificationService.showToast('Exilio por Perturbar', `"${targetStackItem.card.name}" se ha exiliado al ser contrarrestado.`, 'INFO');
            } else {
              targetController.graveyard.push(targetStackItem.card);
              targetController.graveyardCount = targetController.graveyard.length;
            }
            state.stack = state.stack.filter(s => s.id !== targetId);
          }
        }
      } else if (effect === 'COPY_SPELL') {
        const targetStackItem = state.stack.find(s => s.id === targetId);
        if (targetStackItem) {
          const copiedItem: StackItem = {
            ...targetStackItem,
            id: Math.random().toString(36).substr(2, 9),
            name: `Copia de ${targetStackItem.name}`,
          };
          state.stack.push(copiedItem);
          this.notificationService.showToast('Hechizo copiado', `Se ha puesto una copia de "${targetStackItem.name}" en la pila.`, 'SUCCESS');
        }
      }
    } else {
      const p1Card = state.player1.field.find(c => c.id === targetId);
      const p2Card = state.player2.field.find(c => c.id === targetId);
      const targetCard = p1Card || p2Card;
      const ownerId = p1Card ? state.player1.id : state.player2.id;
      const targetPlayerState = p1Card ? state.player1 : state.player2;

      if (targetCard) {
        if (effect === 'DAMAGE') {
          const currentToughness = this.getModifiedToughness(targetCard, targetPlayerState);
          targetCard.damageTaken = (targetCard.damageTaken || 0) + value;
          console.log(`💥 Hechizo inflige ${value} de daño a ${targetCard.name}. Daño acumulado: ${targetCard.damageTaken}/${currentToughness}`);
          
          if (targetCard.damageTaken >= currentToughness) {
            const isIndestructible = this.hasAbility(targetCard, 'indestructible');
            if (isIndestructible) {
              console.log(`🛡️ ${targetCard.name} es Indestructible, el daño no la mata.`);
            } else {
              this.moveToGraveyard(targetCard.id, ownerId);
            }
          }
        } else if (effect === 'DESTROY') {
          const isIndestructible = this.hasAbility(targetCard, 'indestructible');
          if (isIndestructible) {
            console.log(`🛡️ ${targetCard.name} es Indestructible y no puede ser destruida.`);
          } else {
            this.moveToGraveyard(targetCard.id, ownerId);
          }
        } else if (effect === 'BOUNCE') {
          this.returnToHand(targetCard.id, ownerId);
        } else if (effect === 'EXILE') {
          this.exileCard(targetCard.id, ownerId);
        } else if (effect === 'TRANSFORM') {
          this.transformCard(targetCard.id, targetPlayerState);
        } else if (effect === 'BUFF_TEMP') {
          const pMod = (item.effect?.pMod || 0) * mult;
          const tMod = (item.effect?.tMod || 0) * mult;
          targetCard.tempPowerModifier = (targetCard.tempPowerModifier || 0) + pMod;
          targetCard.tempToughnessModifier = (targetCard.tempToughnessModifier || 0) + tMod;
          console.log(`⚡ ${targetCard.name} recibe bono temporal de ${pMod}/${tMod}.`);
        } else if (effect === 'ATTACH_AURA') {
          if (item.card) {
            const auraCardInField = { ...item.card, attachedToCardId: targetCard.id };
            targetCard.attachedCardIds = targetCard.attachedCardIds || [];
            targetCard.attachedCardIds.push(auraCardInField.id);
            targetPlayerState.field.push(auraCardInField);
            console.log(`🔗 Aura ${item.card.name} anexada a ${targetCard.name}`);
          }
        } else if (effect === 'ATTACH_EQUIPMENT' as any) {
          const equipCard = targetPlayerState.field.find(c => c.id === item.sourceCardId);
          if (equipCard) {
            const equipCost = this.parseEquipCost(equipCard);
            const costReq = this.parseManaCost(equipCost);
            this.paySpecificCosts(costReq, targetPlayerState.manaPool);
            
            if (equipCard.attachedToCardId) {
              const oldEnchanted = targetPlayerState.field.find(c => c.id === equipCard.attachedToCardId);
              if (oldEnchanted && oldEnchanted.attachedCardIds) {
                oldEnchanted.attachedCardIds = oldEnchanted.attachedCardIds.filter(id => id !== equipCard.id);
              }
            }
            
            equipCard.attachedToCardId = targetCard.id;
            targetCard.attachedCardIds = targetCard.attachedCardIds || [];
            if (!targetCard.attachedCardIds.includes(equipCard.id)) {
              targetCard.attachedCardIds.push(equipCard.id);
            }
            console.log(`🛡️ Equipment ${equipCard.name} equipado a ${targetCard.name}`);
          }
        } else if (effect === 'FIGHT') {
          const sourceCard = targetPlayerState.field.find(c => c.id === item.sourceCardId) || state.player1.field.find(c => c.id === item.sourceCardId) || state.player2.field.find(c => c.id === item.sourceCardId);
          if (sourceCard && targetCard) {
            const sourceController = state.player1.field.find(c => c.id === sourceCard.id) ? state.player1 : state.player2;
            
            const sourcePower = this.getModifiedPower(sourceCard, sourceController);
            const targetPower = this.getModifiedPower(targetCard, targetPlayerState);

            sourceCard.damageTaken = (sourceCard.damageTaken || 0) + targetPower;
            targetCard.damageTaken = (targetCard.damageTaken || 0) + sourcePower;

            this.notificationService.showToast('Lucha (Fight)', `${sourceCard.name} (${sourcePower} F) y ${targetCard.name} (${targetPower} F) lucharon.`, 'INFO');

            const sourceToughness = this.getModifiedToughness(sourceCard, sourceController);
            const targetToughness = this.getModifiedToughness(targetCard, targetPlayerState);

            if (sourceCard.damageTaken >= sourceToughness && !this.hasAbility(sourceCard, 'indestructible')) {
              this.moveToGraveyard(sourceCard.id, sourceController.id);
            }
            if (targetCard.damageTaken >= targetToughness && !this.hasAbility(targetCard, 'indestructible')) {
              this.moveToGraveyard(targetCard.id, targetPlayerState.id);
            }
          }
        } else if (effect === 'BOUNCE_PERMANENT') {
          this.returnToHand(targetCard.id, ownerId);
        } else if (effect === 'DESTROY_ART_ENC') {
          const isArtOrEnc = targetCard.type?.toLowerCase().includes('artifact') || 
                             targetCard.type?.toLowerCase().includes('enchantment') || 
                             targetCard.type?.toLowerCase().includes('artefacto') || 
                             targetCard.type?.toLowerCase().includes('encantamiento');
          if (isArtOrEnc) {
            const isIndestructible = this.hasAbility(targetCard, 'indestructible');
            if (isIndestructible) {
              console.log(`🛡️ ${targetCard.name} es Indestructible y no puede ser destruida.`);
            } else {
              this.moveToGraveyard(targetCard.id, ownerId);
              this.notificationService.showToast('Destruido', `"${targetCard.name}" ha sido destruido.`, 'SUCCESS');
            }
          } else {
            this.notificationService.showToast('Objetivo inválido', `"${targetCard.name}" no es un Artefacto ni Encantamiento.`, 'WARNING');
          }
        } else if (effect === 'CANT_BE_BLOCKED_TEMP') {
          targetCard.tempUnblockable = true;
          this.notificationService.showToast('Evasión', `"${targetCard.name}" no puede ser bloqueado este turno.`, 'SUCCESS');
        }
      }
    }
  }

  private parseCardEffect(card: GameCard, overrideText?: string): any {
    const text = (overrideText || card.oracleText || '').toLowerCase();
    const type = (card.type || '').toLowerCase();

    // 0. Auras de Encantamiento
    if (type.includes('aura') || type.includes('encantamiento - aura')) {
      return { effect: 'ATTACH_AURA', needsTarget: true, validTargets: 'CREATURE' };
    }
    
    // 1. Buff Temporal: "target creature gets +X/+Y until end of turn"
    const buffTempMatch = text.match(/(?:target creature gets|la criatura objetivo obtiene) ([+-]\d+)\/([+-]\d+) until end of turn/i);
    if (buffTempMatch) {
      return { 
        effect: 'BUFF_TEMP', 
        pMod: parseInt(buffTempMatch[1]), 
        tMod: parseInt(buffTempMatch[2]), 
        needsTarget: true, 
        validTargets: 'CREATURE' 
      };
    }

    // 1.5 SPRINT 13: Incubate X
    const incubateMatch = text.match(/(?:incubate|incubar)\s+(\d+)/i);
    if (incubateMatch) {
      return { effect: 'INCUBATE', value: parseInt(incubateMatch[1]), needsTarget: false };
    }

    // 1.6 SPRINT 13: Connive
    if (text.includes('connives') || text.includes('maquina')) {
      return { effect: 'CONNIVE', needsTarget: false };
    }

    // 1.7 SPRINT 13: Discover X
    const discoverMatch = text.match(/(?:discover|descubrir)\s+(\d+)/i);
    if (discoverMatch) {
      return { effect: 'DISCOVER', value: parseInt(discoverMatch[1]), needsTarget: false };
    }

    // 2. Suma de Contadores ETB: "enters the battlefield with X +1/+1 counters"
    const etbCountersMatch = text.match(/(?:enters the battlefield with|enters with|entra con) (\d+) \+1\/\+1/i);
    if (etbCountersMatch) {
      return { 
        effect: 'ETB_COUNTERS', 
        counterType: '+1/+1', 
        value: parseInt(etbCountersMatch[1]), 
        needsTarget: false 
      };
    }

    // 3. Entra Girado: "enters the battlefield tapped"
    if (text.includes("enters the battlefield tapped") || text.includes("entra al campo de batalla girado")) {
      return { effect: 'ETB_TAPPED', needsTarget: false };
    }

    // 4. Robar cartas: "draw X cards" o "draw X card"
    const drawMatch = text.match(/draw (\d+) card/i);
    if (drawMatch) {
      return { effect: 'DRAW', value: parseInt(drawMatch[1]), needsTarget: false };
    }

    // 5. Daño Directo / Pérdida de Vida
    const damageMatch = text.match(/deal (\d+) damage/i);
    if (damageMatch) {
      const val = parseInt(damageMatch[1]);
      let targets: 'ANY' | 'CREATURE' | 'PLAYER' = 'ANY';
      if (text.includes('target creature or player')) targets = 'ANY';
      else if (text.includes('target creature')) targets = 'CREATURE';
      else if (text.includes('target player')) targets = 'PLAYER';
      
      return { effect: 'DAMAGE', value: val, validTargets: targets, needsTarget: true };
    }

    // 6. Ganar Vida: "you gain X life"
    const gainLifeMatch = text.match(/(?:you gain|ganas) (\d+) life/i);
    if (gainLifeMatch) {
      return { effect: 'LIFE_CHANGE', value: parseInt(gainLifeMatch[1]), needsTarget: false };
    }

    // 7. Perder Vida Rival: "target player loses X life"
    const loseLifeMatch = text.match(/(?:target player loses|el jugador objetivo pierde) (\d+) life/i);
    if (loseLifeMatch) {
      return { effect: 'LIFE_CHANGE', value: -parseInt(loseLifeMatch[1]), needsTarget: true, validTargets: 'PLAYER' };
    }

    // 8. Exilio: "exile target creature", "exile target permanent"
    const exileMatch = text.match(/(?:exile target|exilia la|exilia el) (creature|permanent|card)/i);
    if (exileMatch) {
      return { effect: 'EXILE', needsTarget: true, validTargets: 'CREATURE' };
    }

    // 9. Destrucción: "destroy target creature"
    if (text.includes('destroy target creature')) {
      return { effect: 'DESTROY', validTargets: 'CREATURE', needsTarget: true };
    }

    // 10. Regresar a la mano (Bounce): "return target creature to owner's hand"
    if (text.includes("return target creature to its owner's hand") || 
        text.includes("return target creature to owner's hand") || 
        text.includes('devuelve la criatura objetivo a la mano')) {
      return { effect: 'BOUNCE', validTargets: 'CREATURE', needsTarget: true };
    }

    // 11. Self-Buff (Auto-Mejora): "gets +X/+Y until end of turn" (sin target)
    const selfBuffMatch = text.match(/(?:gets|obtiene) ([+-]\d+)\/([+-]\d+) until end of turn/i);
    if (selfBuffMatch && !text.includes('target')) {
      return { 
        effect: 'SELF_BUFF_TEMP', 
        pMod: parseInt(selfBuffMatch[1]), 
        tMod: parseInt(selfBuffMatch[2]), 
        needsTarget: false 
      };
    }

    // 12. Crear Fichas (Tokens): "create X Y/Z token"
    const tokenMatchSingle = text.match(/create (?:a|an|\d+)\s+(\d+)\/(\d+)\s+([\w\s\-]+?)\s+token/i);
    if (tokenMatchSingle) {
      const qtyMatch = text.match(/create (\d+)/i);
      const count = qtyMatch ? parseInt(qtyMatch[1]) : 1;
      return {
        effect: 'CREATE_TOKEN',
        count: count,
        power: parseInt(tokenMatchSingle[1]),
        toughness: parseInt(tokenMatchSingle[2]),
        name: tokenMatchSingle[3].trim(),
        needsTarget: false
      };
    }

    // 13. Mill (Fresado): "target player mills X cards"
    const millMatch = text.match(/(?:target player mills|el jugador objetivo fresa) (\d+)/i);
    if (millMatch) {
      return {
        effect: 'MILL',
        value: parseInt(millMatch[1]),
        needsTarget: true,
        validTargets: 'PLAYER'
      };
    }

    // 14. Counter Spell: "counter target spell"
    if (text.includes('counter target spell') || text.includes('contrarresta el hechizo objetivo')) {
      return {
        effect: 'COUNTER_SPELL',
        needsTarget: true,
        validTargets: 'SPELL_ON_STACK'
      };
    }

    // 14b. Copy Spell: "copy target spell"
    if (text.includes('copy target spell') || text.includes('copia el hechizo objetivo') || text.includes('copia el hechizo de criatura objetivo')) {
      return {
        effect: 'COPY_SPELL',
        needsTarget: true,
        validTargets: 'SPELL_ON_STACK'
      };
    }

    // 15. Tutor: "search your library for a card"
    if (text.includes('search your library for a card') || text.includes('busca en tu biblioteca una carta')) {
      return {
        effect: 'TUTOR',
        needsTarget: false
      };
    }

    // 16. Transform: "transform [this/target]"
    if (text.includes('transform this') || text.includes('transforma esta') || text.includes('transform target') || text.includes('transforma la criatura objetivo') || text.includes('transforma este') || text.includes('transform ')) {
      const needsTarget = text.includes('target') || text.includes('objetivo');
      return {
        effect: 'TRANSFORM',
        needsTarget: needsTarget,
        validTargets: 'CREATURE'
      };
    }

    // 17. Scry: "scry X"
    const scryMatch = text.match(/(?:scry|adivina)\s+(\d+)/i);
    if (scryMatch) {
      return {
        effect: 'SCRY',
        value: parseInt(scryMatch[1]),
        needsTarget: false
      };
    }

    // 18. Surveil: "surveil X"
    const surveilMatch = text.match(/(?:surveil|vigila)\s+(\d+)/i);
    if (surveilMatch) {
      return {
        effect: 'SURVEIL',
        value: parseInt(surveilMatch[1]),
        needsTarget: false
      };
    }

    // --- SPRINT 7: MECÁNICAS DE LUCHA, SACRIFICIO Y EFECTOS DE CEMENTERIO ---
    // A. Lucha: "fights target creature"
    if (text.includes('fights target creature') || text.includes('lucha contra la criatura objetivo')) {
      return { effect: 'FIGHT', validTargets: 'CREATURE', needsTarget: true };
    }

    // B. Sacrificar criatura/permanente como efecto
    if (text.includes('target player sacrifices') || text.includes('el jugador objetivo sacrifica')) {
      return { effect: 'SACRIFICE_TARGET_PLAYER', validTargets: 'PLAYER', needsTarget: true };
    }
    if (text.includes('sacrifice a creature') || text.includes('sacrifice a permanent') || text.includes('sacrifica una criatura') || text.includes('sacrifica un permanente')) {
      return { effect: 'SACRIFICE', needsTarget: false };
    }

    // C. Exiliar de cementerio
    if (text.includes('exile target card from a graveyard') || text.includes('exile target card from graveyard') || text.includes('exilia la carta objetivo de un cementerio')) {
      return { effect: 'EXILE_FROM_GRAVEYARD', validTargets: 'PLAYER', needsTarget: true };
    }

    // D. Regresar de cementerio a la mano
    if (text.includes('return target card from your graveyard to your hand') || text.includes('return target card from graveyard to hand') || text.includes('devuelve la carta objetivo de tu cementerio')) {
      return { effect: 'RETURN_FROM_GRAVEYARD', needsTarget: false };
    }

    // E. Regresar permanente a la mano (Bounce permanent)
    if (text.includes('return target permanent to its owner\'s hand') || text.includes('return target permanent to hand') || text.includes('devuelve el permanente objetivo')) {
      return { effect: 'BOUNCE_PERMANENT', validTargets: 'CREATURE', needsTarget: true };
    }

    // F. Destruir artefacto/encantamiento
    if (text.includes('destroy target artifact or enchantment') || text.includes('destruye el artefacto o encantamiento objetivo')) {
      return { effect: 'DESTROY_ART_ENC', validTargets: 'CREATURE', needsTarget: true };
    }

    // G. Sweeper: deals X damage to each creature
    const sweeperMatch = text.match(/(?:deals|hace) (\d+) damage to each creature/i) || text.match(/hace (\d+) daño a cada criatura/i);
    if (sweeperMatch) {
      return { effect: 'DAMAGE_EACH_CREATURE', value: parseInt(sweeperMatch[1]), needsTarget: false };
    }

    // H. Imbloqueable temporal
    if (text.includes('target creature can\'t be blocked this turn') || text.includes('la criatura objetivo no puede ser bloqueada este turno')) {
      return { effect: 'CANT_BE_BLOCKED_TEMP', validTargets: 'CREATURE', needsTarget: true };
    }

    return null;
  }

  private processETBEffects(card: GameCard, player: PlayerGameState, state: GameState): void {
    const text = (card.oracleText || '').toLowerCase();
    
    // 1. Entrar girado
    if (text.includes("enters the battlefield tapped") || text.includes("entra al campo de batalla girado")) {
      card.isTapped = true;
      console.log(`🔒 ${card.name} entra girado al campo de batalla.`);
    }
    
    // 2. Entrar con contadores +1/+1
    const counterMatch = text.match(/(?:enters the battlefield with|enters with|entra con) (\d+) \+1\/\+1/i);
    if (counterMatch) {
      const qty = parseInt(counterMatch[1]);
      card.counters = card.counters || {};
      card.counters['+1/+1'] = (card.counters['+1/+1'] || 0) + qty;
      console.log(`✨ ${card.name} entra con ${qty} contador(es) +1/+1.`);
    }

    // 3. Sagas, Planeswalkers y Batallas (Sprint 10)
    const isSaga = card.type?.toLowerCase().includes('saga');
    if (isSaga) {
      card.isSaga = true;
      card.counters = card.counters || {};
      card.counters['lore'] = 1;
      this.triggerSagaChapter(card, 1, player, state);
    }

    const isPlaneswalker = card.type?.toLowerCase().includes('planeswalker') || card.type?.toLowerCase().includes('caminante');
    if (isPlaneswalker) {
      card.isPlaneswalker = true;
      card.counters = card.counters || {};
      card.counters['loyalty'] = this.getPlaneswalkerStartingLoyalty(card);
      card.loyaltyUsedThisTurn = false;
    }

    const isBattle = card.type?.toLowerCase().includes('battle') || card.type?.toLowerCase().includes('batalla');
    if (isBattle) {
      card.isBattle = true;
      card.counters = card.counters || {};
      card.counters['defense'] = this.getBattleStartingDefense(card);
      card.battleProtectorId = player.id === state.player1.id ? state.player2.id : state.player1.id;
    }
  }

  private executeNonTargetEffect(effect: any, player: PlayerGameState, kicked = false, sourceCardId?: string, state?: GameState): void {
    if (!effect) return;
    const mult = kicked ? 2 : 1;
    const value = (effect.value || 0) * mult;

    if (effect.effect === 'DRAW') {
      for (let i = 0; i < value; i++) {
        this.drawCardToPlayer(player);
      }
      this.notificationService.showToast('Robo', `Has robado ${value} cartas.`, 'SUCCESS');
    } else if (effect.effect === 'LIFE_CHANGE') {
      player.hp += value;
      const type = value > 0 ? 'Ganancia' : 'Pérdida';
      const toastType = value > 0 ? 'SUCCESS' : 'WARNING';
      this.notificationService.showToast(type, `${player.username} ha modificado su vida por ${value}.`, toastType);
    } else if (effect.effect === 'SELF_BUFF_TEMP' && sourceCardId) {
      const targetCard = player.field.find(c => c.id === sourceCardId);
      if (targetCard) {
        const pMod = (effect.pMod || 0) * mult;
        const tMod = (effect.tMod || 0) * mult;
        targetCard.tempPowerModifier = (targetCard.tempPowerModifier || 0) + pMod;
        targetCard.tempToughnessModifier = (targetCard.tempToughnessModifier || 0) + tMod;
        console.log(`⚡ ${targetCard.name} recibe auto-mejora temporal de ${pMod}/${tMod}.`);
        this.notificationService.showToast('Auto-mejora', `"${targetCard.name}" obtiene +${pMod}/+${tMod} hasta el final del turno.`, 'SUCCESS');
      }
    } else if (effect.effect === 'CREATE_TOKEN' && state) {
      const count = effect.count || 1;
      for (let i = 0; i < count; i++) {
        const tokenCard: GameCard = {
          id: 'token_' + Math.random().toString(36).substr(2, 9),
          name: effect.name + ' Token',
          type: 'Creature Token',
          manaCost: [],
          power: effect.power.toString(),
          toughness: effect.toughness.toString(),
          oracleText: 'Token',
          imageUrl: 'assets/images/cards/token.png',
          isToken: true,
          enteredFieldTurn: state.turnCount,
          isTapped: false,
          tempPowerModifier: 0,
          tempToughnessModifier: 0
        };
        player.field.push(tokenCard);
      }
      this.notificationService.showToast('Creación de Ficha', `Se han creado ${count} ficha(s) ${effect.power}/${effect.toughness} ${effect.name}.`, 'SUCCESS');
    } else if (effect.effect === 'INCUBATE' && state) {
      const incubatorCount = value;
      const tokenCard: GameCard = {
        id: 'token_incubator_' + Math.random().toString(36).substr(2, 9),
        name: 'Incubator Token',
        type: 'Artifact Token — Incubator',
        manaCost: [],
        power: '0',
        toughness: '0',
        oracleText: '{2}: Transform this artifact. It transforms into a 0/0 Phyrexian artifact creature.',
        imageUrl: 'https://cards.scryfall.io/large/front/d/0/d0834ba7-6dd7-4eaf-801d-54f3c706bf9d.jpg?1682207399',
        isToken: true,
        enteredFieldTurn: state.turnCount,
        isTapped: false,
        counters: { '+1/+1': incubatorCount },
        canTransform: true, 
        hasIncubateTransform: true,
        tempPowerModifier: 0,
        tempToughnessModifier: 0
      };
      player.field.push(tokenCard);
      this.notificationService.showToast('Incubar', `Has creado un token Incubador con ${incubatorCount} contador(es) +1/+1.`, 'SUCCESS');
    } else if (effect.effect === 'CONNIVE' && state) {
      this.drawCardToPlayer(player);
      state.pendingDiscard = { count: 1, triggerTargetId: sourceCardId, forConnive: true };
      this.notificationService.showToast('Maquinar', `Has robado una carta. Selecciona una carta de tu mano para descartar.`, 'INFO');
      this.gameStateSubject.next({ ...state });
    } else if (effect.effect === 'DISCOVER' && state) {
      this.startDiscover(player.id, value, false);
    } else if (effect.effect === 'TUTOR') {
      if (player.library.length > 0) {
        const cardIndex = player.library.findIndex(c => !c.type?.toLowerCase().includes('land'));
        const pickedIndex = cardIndex !== -1 ? cardIndex : 0;
        const pickedCard = player.library.splice(pickedIndex, 1)[0];
        
        player.hand.push(pickedCard);
        player.handCount = player.hand.length;
        
        this.shuffle(player.library);
        player.libraryCount = player.library.length;
        this.notificationService.showToast('Búsqueda (Tutor)', `Has buscado y añadido "${pickedCard.name}" a tu mano. Biblioteca barajada.`, 'SUCCESS');
      } else {
        this.notificationService.showToast('Biblioteca vacía', 'No quedan cartas en tu biblioteca.', 'WARNING');
      }
    } else if (effect.effect === 'TRANSFORM' && sourceCardId) {
      this.transformCard(sourceCardId, player);
    } else if (effect.effect === 'SCRY' || effect.effect === 'SURVEIL') {
      if (player.library.length > 0) {
        const count = Math.min(value, player.library.length);
        
        if (player.id === state?.player1.id) {
          // Jugador Humano: Splice out y congelar el estado con pendingScrySurveilChoice
          const cards = player.library.splice(0, count);
          state.pendingScrySurveilChoice = {
            playerId: player.id,
            type: effect.effect,
            cards: cards,
            value: value,
            sourceCardId: sourceCardId || ''
          };
          player.libraryCount = player.library.length;
          console.log(`👁️ Jugador Humano inicia ${effect.effect} de ${count} cartas.`);
          this.notificationService.showToast(
            effect.effect === 'SCRY' ? 'Adivinar (Scry)' : 'Vigilar (Surveil)',
            `Selecciona el destino de las primeras ${count} cartas de tu biblioteca.`,
            'SUCCESS'
          );
        } else {
          // IA / Bot: Automatizar la elección de forma inteligente
          const cards = player.library.splice(0, count);
          const botLands = player.field.filter(c => c.type?.toLowerCase().includes('land')).length;
          const topCards: GameCard[] = [];
          const bottomCards: GameCard[] = [];
          const graveyardCards: GameCard[] = [];

          for (const card of cards) {
            const isLand = card.type?.toLowerCase().includes('land');
            if (effect.effect === 'SCRY') {
              if (isLand && botLands >= 4) {
                bottomCards.push(card);
              } else {
                topCards.push(card);
              }
            } else { // SURVEIL
              if (isLand && botLands >= 4) {
                graveyardCards.push(card);
              } else {
                topCards.push(card);
              }
            }
          }

          player.library.unshift(...topCards);
          player.library.push(...bottomCards);
          player.graveyard.push(...graveyardCards);

          player.libraryCount = player.library.length;
          player.graveyardCount = player.graveyard.length;

          if (effect.effect === 'SCRY') {
            this.notificationService.showToast('Adivinar (Bot)', `Bot adivinó ${value} cartas: ${topCards.length} arriba, ${bottomCards.length} abajo.`, 'INFO');
          } else {
            this.notificationService.showToast('Vigilar (Bot)', `Bot vigiló ${value} cartas: ${topCards.length} arriba, ${graveyardCards.length} al cementerio.`, 'INFO');
          }
        }
      } else {
        this.notificationService.showToast('Biblioteca vacía', 'No quedan cartas en la biblioteca para adivinar/vigilar.', 'WARNING');
      }
    } else if (effect.effect === 'SACRIFICE') {
      if (state) {
        state.pendingSacrificeChoice = {
          playerId: player.id,
          count: 1,
          validTypes: 'CREATURE',
          sourceCardId: sourceCardId
        };
        this.notificationService.showToast('Sacrificio', 'Debes seleccionar una criatura propia para sacrificar.', 'INFO');
        this.checkAutomatedSacrifice();
      }
    } else if (effect.effect === 'RETURN_FROM_GRAVEYARD') {
      if (state) {
        state.pendingGraveyardSelection = {
          playerId: player.id,
          effectType: 'RETURN_TO_HAND',
          sourceCardId: sourceCardId
        };
        this.notificationService.showToast('Selección del cementerio', 'Abre tu cementerio para regresar una carta a tu mano.', 'INFO');
        this.checkAutomatedGraveyardSelection();
      }
    } else if (effect.effect === 'DAMAGE_EACH_CREATURE' && state) {
      const allCreatures = [...state.player1.field, ...state.player2.field].filter(c => {
        const isLand = c.type?.toLowerCase().includes('land') || c.type?.toLowerCase().includes('tierra');
        const isVehicle = c.type?.toLowerCase().includes('vehicle') || c.type?.toLowerCase().includes('vehículo');
        if (isVehicle) return c.crewed;
        return !isLand;
      });

      allCreatures.forEach(c => {
        const controller = state.player1.field.find(card => card.id === c.id) ? state.player1 : state.player2;
        const currentToughness = this.getModifiedToughness(c, controller);
        c.damageTaken = (c.damageTaken || 0) + value;
        console.log(`💥 Sweeper inflige ${value} de daño a ${c.name}. Daño acumulado: ${c.damageTaken}/${currentToughness}`);
        
        if (c.damageTaken >= currentToughness) {
          const isIndestructible = this.hasAbility(c, 'indestructible');
          if (isIndestructible) {
            console.log(`🛡️ ${c.name} es Indestructible y sobrevive al Sweeper.`);
          } else {
            this.moveToGraveyard(c.id, controller.id);
          }
        }
      });
      this.notificationService.showToast('Barredor (Sweeper)', `Se infligieron ${value} de daño a todas las criaturas.`, 'WARNING');
    }
  }

  private drawCardToPlayer(p: PlayerGameState): void {
    if (p.library.length > 0) {
      const card = p.library.shift()!;
      p.hand.push(card);
      p.handCount = p.hand.length;
      p.libraryCount = p.library.length;
    }
  }

  private isFastCard(card: GameCard): boolean {
    const type = (card.type || '').toLowerCase();
    const isInstant = type.includes('instant') || type.includes('instantáneo');
    const hasFlash = this.hasAbility(card, 'flash') || this.hasAbility(card, 'destello');
    return isInstant || hasFlash;
  }

  private isSpell(card: GameCard): boolean {
    const type = (card.type || '').toLowerCase();
    return type.includes('instant') || type.includes('sorcery') || 
           type.includes('instantáneo') || type.includes('conjuro') ||
           type.includes('creature') || type.includes('criatura') ||
           type.includes('artifact') || type.includes('artefacto') ||
           type.includes('enchantment') || type.includes('encantamiento') ||
           type.includes('planeswalker');
  }

  private parseManaCost(cost: string[]): any {
    const req: any = { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0, generic: 0 };
    cost.forEach(s => {
      const v = s.toUpperCase().replace(/{|}/g, '');
      if (v === 'W') req.white++;
      else if (v === 'U') req.blue++;
      else if (v === 'B') req.black++;
      else if (v === 'R') req.red++;
      else if (v === 'G') req.green++;
      else if (v === 'C') req.colorless++;
      else if (!isNaN(parseInt(v))) req.generic += parseInt(v);
    });
    return req;
  }

  private canAffordParsed(req: any, pool: ManaPool): boolean {
    if (pool.white < req.white) return false;
    if (pool.blue < req.blue) return false;
    if (pool.black < req.black) return false;
    if (pool.red < req.red) return false;
    if (pool.green < req.green) return false;
    if (pool.colorless < req.colorless) return false;

    const totalAvailableAfterSpecific = 
      (pool.white - req.white) + (pool.blue - req.blue) + 
      (pool.black - req.black) + (pool.red - req.red) + 
      (pool.green - req.green) + (pool.colorless - req.colorless);
    
    return totalAvailableAfterSpecific >= req.generic;
  }

  private paySpecificCosts(req: any, pool: ManaPool): void {
    pool.white -= req.white;
    pool.blue -= req.blue;
    pool.black -= req.black;
    pool.red -= req.red;
    pool.green -= req.green;
    pool.colorless -= req.colorless;
  }

  payGenericMana(color: string): void {
    const state = this.gameStateSubject.value;
    if (!state?.pendingPayment) return;

    const p = this.me();
    if (!p) return;
    
    const poolKey = color as keyof ManaPool;
    if (p.manaPool[poolKey] <= 0) return;

    p.manaPool[poolKey]--;
    state.pendingPayment.remainingGeneric--;

    if (state.pendingPayment.remainingGeneric <= 0) {
      this.isProcessing = true;
      this.finishPlayingCard(state.pendingPayment.cardId);
    } else {
      this.gameStateSubject.next({ ...state });
    }
  }

  autoPayGeneric(): void {
    const state = this.gameStateSubject.value;
    if (!state?.pendingPayment) return;
    
    const p = this.me();
    if (!p) return;

    this.autoPayGenericInternal(p.manaPool, state.pendingPayment.remainingGeneric);
    this.isProcessing = true;
    this.finishPlayingCard(state.pendingPayment.cardId);
  }

  private autoPayGenericInternal(pool: ManaPool, amount: number): void {
    let remaining = amount;
    // Priority 1: Colorless
    const colorlessSpend = Math.min(pool.colorless, remaining);
    pool.colorless -= colorlessSpend;
    remaining -= colorlessSpend;

    if (remaining <= 0) return;

    // Priority 2: Colors (equally distributed to keep a balanced pool if possible)
    const colors: (keyof ManaPool)[] = ['white', 'blue', 'black', 'red', 'green'];
    while (remaining > 0) {
      // Find color with most mana to spend first
      let bestColor: keyof ManaPool | null = null;
      let maxVal = 0;
      for (const c of colors) {
        if (pool[c] > maxVal) {
          maxVal = pool[c];
          bestColor = c;
        }
      }
      if (!bestColor) break; // Should not happen if canAfford was true
      pool[bestColor]--;
      remaining--;
    }
  }

  cancelPayment(): void {
    const state = this.gameStateSubject.value;
    if (!state?.pendingPayment) return;
    
    // We need to refund the mana and restore state
    // But since we just want to cancel, the easiest is to just refresh state from server 
    // or manually undo. For now, let's just clear the pending state and NOT update server.
    // However, mana was already subtracted locally. 
    // Best practice: Reload state from server.
    this.isProcessing = false;
    this.refreshGameState();
  }

  // --- SPRINT 9: METODOS AUXILIARES DE CANALIZAR (CHANNEL) ---
  channelChoicePassedSet = new Set<string>();
  pendingChannelStackItem?: StackItem;

  resolveChannelChoice(isChannel: boolean): void {
    const state = this.gameStateSubject.value;
    if (!state?.pendingChannelChoice) return;
    
    const choice = state.pendingChannelChoice;
    const cardId = choice.cardId;
    state.pendingChannelChoice = undefined; // Clear choice
    
    if (isChannel) {
      // Execute channel cast!
      this.isProcessing = true;
      this.finishChannelCast(cardId, choice.channelCost);
    } else {
      // Proceed with normal cast but flag it so it doesn't trigger channel choice again!
      this.channelChoicePassedSet.add(cardId);
      this.isProcessing = false;
      this.playCard(cardId);
    }
  }

  cancelChannelChoice(): void {
    const state = this.gameStateSubject.value;
    if (!state) return;
    state.pendingChannelChoice = undefined;
    this.gameStateSubject.next({ ...state });
  }

  // --- SPRINT 11: METODOS AUXILIARES DE AVENTURA (ADVENTURE) ---
  adventureChoicePassedSet = new Set<string>();

  resolveAdventureChoice(castAsAdventure: boolean): void {
    const state = this.gameStateSubject.value;
    if (!state?.pendingAdventureChoice) return;

    const choice = state.pendingAdventureChoice;
    const cardId = choice.cardId;
    state.pendingAdventureChoice = undefined; // Clear choice

    const p = this.me();
    if (!p) return;
    const card = p.hand.find(c => c.id === cardId);
    if (!card) return;

    if (castAsAdventure) {
      card.castAsAdventure = true;
      this.isProcessing = false;
      this.playCard(cardId);
    } else {
      this.adventureChoicePassedSet.add(cardId);
      card.castAsAdventure = false;
      this.isProcessing = false;
      this.playCard(cardId);
    }
  }

  cancelAdventureChoice(): void {
    const state = this.gameStateSubject.value;
    if (!state) return;
    state.pendingAdventureChoice = undefined;
    this.gameStateSubject.next({ ...state });
  }

  // --- SPRINT 15: METODOS AUXILIARES DE CONCESIÓN (BESTOW) ---
  bestowChoicePassedSet = new Set<string>();

  resolveBestowChoice(castAsBestow: boolean): void {
    const state = this.gameStateSubject.value;
    if (!state?.pendingBestowChoice) return;

    const choice = state.pendingBestowChoice;
    const cardId = choice.cardId;
    state.pendingBestowChoice = undefined;

    const p = this.me();
    if (!p) return;
    const card = p.hand.find(c => c.id === cardId);
    if (!card) return;

    if (castAsBestow) {
      card.castAsBestow = true;
      this.isProcessing = false;
      this.playCard(cardId);
    } else {
      this.bestowChoicePassedSet.add(cardId);
      card.castAsBestow = false;
      this.isProcessing = false;
      this.playCard(cardId);
    }
  }

  cancelBestowChoice(): void {
    const state = this.gameStateSubject.value;
    if (!state) return;
    state.pendingBestowChoice = undefined;
    this.gameStateSubject.next({ ...state });
  }

  private hasBestow(card: GameCard): boolean {
    const text = (card.oracleText || '').toLowerCase();
    return text.includes('bestow') || text.includes('concesión') || text.includes('otorgar');
  }

  private parseBestowCost(card: GameCard): string[] {
    const text = (card.oracleText || '').toLowerCase();
    const match = text.match(/(?:bestow|concesión|otorgar)\s+((?:\{[a-zA-Z0-9\/]+\})+)/i);
    if (match) {
      const costStr = match[1];
      const symbols = costStr.match(/\{[a-zA-Z0-9\/]+\}/g);
      return symbols || [];
    }
    return [];
  }

  // --- SPRINT 12: METODOS AUXILIARES DE MDFC (MODAL DFC) ---
  resolveMdfcChoice(faceIndex: number): void {
    const state = this.gameStateSubject.value;
    if (!state?.pendingMdfcChoice) return;

    const choice = state.pendingMdfcChoice;
    const cardId = choice.cardId;
    state.pendingMdfcChoice = undefined;

    const p = this.me();
    if (!p) return;
    const card = p.hand.find(c => c.id === cardId);
    if (!card) return;

    card.mdfcFaceSelected = faceIndex;
    
    if (faceIndex === 1) {
      card.currentFaceIndex = 1;
      card.name = choice.face1Name;
      card.manaCost = choice.face1Cost;
      card.type = choice.face1Type;
    }

    this.isProcessing = false;
    this.playCard(cardId);
  }

  cancelMdfcChoice(): void {
    const state = this.gameStateSubject.value;
    if (!state) return;
    state.pendingMdfcChoice = undefined;
    this.gameStateSubject.next({ ...state });
  }

  // --- SPRINT 13: DISCOVER / CASCADE LOGIC ---
  startDiscover(playerId: string, limit: number, isCascade: boolean): void {
    const state = this.gameStateSubject.value;
    if (!state) return;
    const p = state.player1.id === playerId ? state.player1 : state.player2;
    if (!p) return;

    let foundCard: GameCard | null = null;
    const revealed: GameCard[] = [];

    // Excavate library
    while (p.library.length > 0) {
      const top = p.library.shift()!;
      revealed.push(top);

      const isNonLand = !(top.type?.toLowerCase()?.includes('land') || top.type?.toLowerCase()?.includes('tierra'));
      const cmc = this.calculateManaValue(top);

      if (isNonLand && cmc <= (isCascade ? limit - 1 : limit)) {
        foundCard = top;
        break; // Found it!
      }
    }

    state.pendingDiscoverChoice = {
      playerId,
      cardsRevealed: revealed,
      foundCard,
      isCascade,
      manaValueLimit: limit
    };

    this.notificationService.showToast(isCascade ? 'Cascada' : 'Descubrir', `Excavando en la biblioteca...`, 'INFO');
    this.gameStateSubject.next({ ...state });
  }

  resolveDiscoverChoice(castFree: boolean): void {
    const state = this.gameStateSubject.value;
    if (!state || !state.pendingDiscoverChoice) return;

    const choice = state.pendingDiscoverChoice;
    const p = state.player1.id === choice.playerId ? state.player1 : state.player2;

    if (choice.foundCard) {
      // Remove it from revealed array
      const fIndex = choice.cardsRevealed.findIndex(c => c.id === choice.foundCard!.id);
      if (fIndex !== -1) choice.cardsRevealed.splice(fIndex, 1);

      if (castFree) {
        this.castFreeSpell(choice.foundCard, p, state);
      } else {
        if (choice.isCascade) {
          choice.cardsRevealed.push(choice.foundCard); // Cascade puts uncast card on bottom
        } else {
          p.hand.push(choice.foundCard); // Discover puts uncast card in hand
          p.handCount = p.hand.length;
          this.notificationService.showToast('Descubrir', `Has puesto ${choice.foundCard.name} en tu mano.`, 'SUCCESS');
        }
      }
    }

    // Put remaining revealed cards on the bottom of the library in random order
    const shuffledRevealed = choice.cardsRevealed.sort(() => Math.random() - 0.5);
    p.library.push(...shuffledRevealed);

    state.pendingDiscoverChoice = undefined;
    this.gameStateSubject.next({ ...state });
  }

  private castFreeSpell(card: GameCard, p: PlayerGameState, state: GameState): void {
    const effect = this.parseCardEffect(card);
    const stackItem: StackItem = {
      id: Math.random().toString(36).substr(2, 9),
      sourceCardId: card.id,
      controllerId: p.id,
      type: 'SPELL',
      name: card.name,
      card: { ...card },
      imageUrl: card.imageUrl,
      effect: effect,
      kicked: false
    };
    state.stack.push(stackItem);
    this.notificationService.showToast('Lanzamiento Libre', `¡Se ha lanzado ${card.name} sin pagar coste!`, 'SUCCESS');
  }

  private calculateManaValue(card: GameCard): number {
    const costReq = this.parseManaCost(card.manaCost || []);
    return costReq.generic + costReq.white + costReq.blue + costReq.black + costReq.red + costReq.green;
  }

  // --- SPRINT 13: METODOS DE TRANSFORMACION DE INCUBATOR ---
  transformIncubator(cardId: string): void {
    const state = this.gameStateSubject.value;
    if (!state || this.isProcessing) return;
    this.isProcessing = true;

    const p = this.me();
    if (!p) {
      this.isProcessing = false;
      return;
    }

    const token = p.field.find(c => c.id === cardId);
    if (!token || !token.hasIncubateTransform) {
      this.isProcessing = false;
      return;
    }

    // Try paying {2}
    const costReq = this.parseManaCost(['2']);
    if (!this.canAffordParsed(costReq, p.manaPool)) {
      this.notificationService.showToast('Falta maná', `No tienes suficiente maná para despertar al Incubador (Requiere {2}).`, 'WARNING');
      this.isProcessing = false;
      return;
    }
    
    // Pay it
    this.paySpecificCosts(costReq, p.manaPool);
    this.autoPayGenericInternal(p.manaPool, costReq.generic);

    // Transform it
    token.hasIncubateTransform = false; // already transformed
    token.canTransform = false;
    token.name = 'Phyrexian Incubator';
    token.type = 'Artifact Creature Token — Phyrexian';
    token.imageUrl = 'https://cards.scryfall.io/large/back/d/0/d0834ba7-6dd7-4eaf-801d-54f3c706bf9d.jpg?1682207399';
    // Power and toughness are 0/0 natively, the counters are retained
    
    this.notificationService.showToast('Despertar Pirexiano', `¡La Incubadora ha despertado como una criatura Pirexiana!`, 'SUCCESS');
    
    this.gameStateSubject.next({ ...state });
    this.isProcessing = false;
  }

  playCardFromExile(cardId: string): void {
    const state = this.gameStateSubject.value;
    if (!state || this.isProcessing) return;
    this.isProcessing = true;

    const p = this.me();
    if (!p) {
      this.isProcessing = false;
      return;
    }

    const cardIndex = p.exile.findIndex(c => c.id === cardId);
    if (cardIndex === -1) {
      this.isProcessing = false;
      return;
    }
    const card = p.exile[cardIndex];
    if (!card.adventureExiled) {
      this.notificationService.showToast('Acción inválida', 'Solo puedes lanzar criaturas en una aventura desde el exilio.', 'WARNING');
      this.isProcessing = false;
      return;
    }

    // Cast as a normal creature
    card.adventureExiled = false; // Clear flag
    card.castAsAdventure = false; // Ensure it is cast as creature
    
    // Move from exile to hand temporarily so playCard can process it normally!
    p.exile.splice(cardIndex, 1);
    p.exileCount = p.exile.length;
    p.hand.push(card);
    p.handCount = p.hand.length;
    
    this.isProcessing = false;
    this.playCard(card.id);
  }

  private finishChannelCast(cardId: string, channelCost: string[]): void {
    const state = this.gameStateSubject.value;
    const p = this.me();
    if (!state || !p) {
      this.isProcessing = false;
      return;
    }

    const cardIndex = p.hand.findIndex(c => c.id === cardId);
    if (cardIndex === -1) {
      this.isProcessing = false;
      return;
    }
    const card = p.hand[cardIndex];

    // Subtract channel cost
    const costReq = this.parseManaCost(channelCost);
    if (!this.canAffordParsed(costReq, p.manaPool)) {
      this.notificationService.showToast('Falta maná', `No tienes suficiente maná para canalizar "${card.name}".`, 'WARNING');
      this.isProcessing = false;
      return;
    }

    this.paySpecificCosts(costReq, p.manaPool);
    this.autoPayGenericInternal(p.manaPool, costReq.generic);

    // Discard from hand
    p.hand.splice(cardIndex, 1);
    p.graveyard.push(card);
    p.handCount = p.hand.length;
    p.graveyardCount = p.graveyard.length;

    // Parse Channel effect
    const effect = this.parseChannelEffect(card);

    // Create Stack Item (Ability type)
    const stackItem: StackItem = {
      id: Math.random().toString(36).substr(2, 9),
      sourceCardId: card.id,
      controllerId: p.id,
      type: 'ABILITY',
      name: `${card.name} (Canalizado)`,
      card: { ...card },
      imageUrl: card.imageUrl,
      effect: effect
    };

    // If it needs target, set up pending target
    if (effect && effect.needsTarget && !state.pendingTarget) {
      state.pendingTarget = {
        sourceCardId: card.id,
        validTargets: effect.validTargets,
        effect: effect.effect,
        value: effect.value
      };
      this.notificationService.showToast('Selecciona objetivo', `Elige un objetivo para la habilidad de canalizar de ${card.name}`, 'INFO');
      
      this.pendingChannelStackItem = stackItem;
      this.gameStateSubject.next({ ...state });
      this.isProcessing = false;
      return;
    }

    const newStack = [...state.stack, stackItem];
    this.updateState({
      stack: newStack,
      passedCount: 0
    }, true, () => {
      this.isProcessing = false;
    });
  }

  private parseChannelCost(card: GameCard): string[] {
    const text = (card.oracleText || '').toLowerCase();
    const match = text.match(/(?:channel|canalizar)\s*[-—]\s*([^,:]+)/i);
    if (match) {
      const costStr = match[1].trim();
      const matches = costStr.match(/{[^}]+}/g);
      if (matches) {
        return matches;
      }
    }
    return [];
  }

  private parseChannelEffect(card: GameCard): any {
    const text = (card.oracleText || '').toLowerCase();
    const match = text.match(/(?:channel|canalizar)\s*[-—]\s*[^:]+:\s*(.*)/i);
    if (match) {
      const effectText = match[1].trim();
      return this.parseCardEffect(card, effectText);
    }
    return null;
  }


  private spendMana(cost: string[], pool: ManaPool): void {
    const req: any = { white: 0, blue: 0, black: 0, red: 0, green: 0, generic: 0 };
    cost.forEach(s => {
      const v = s.toUpperCase().replace(/{|}/g, '');
      if (v === 'W') req.white++;
      else if (v === 'U') req.blue++;
      else if (v === 'B') req.black++;
      else if (v === 'R') req.red++;
      else if (v === 'G') req.green++;
      else if (!isNaN(parseInt(v))) req.generic += parseInt(v);
    });

    pool.white -= req.white;
    pool.blue -= req.blue;
    pool.black -= req.black;
    pool.red -= req.red;
    pool.green -= req.green;

    let remainingGeneric = req.generic;
    // Consume colorless first for generic
    const consume = (type: keyof ManaPool, amt: number) => {
      const take = Math.min((pool as any)[type], amt);
      (pool as any)[type] -= take;
      return amt - take;
    };

    remainingGeneric = consume('colorless', remainingGeneric);
    if (remainingGeneric > 0) remainingGeneric = consume('white', remainingGeneric);
    if (remainingGeneric > 0) remainingGeneric = consume('blue', remainingGeneric);
    if (remainingGeneric > 0) remainingGeneric = consume('black', remainingGeneric);
    if (remainingGeneric > 0) remainingGeneric = consume('red', remainingGeneric);
    if (remainingGeneric > 0) remainingGeneric = consume('green', remainingGeneric);
  }

  discardCard(cardId: string): void {
    const state = this.gameStateSubject.value;
    if (!state) return;
    
    // Allow discard if in END phase (cleanup) OR if there is a pendingDiscard active
    if (state.currentPhase !== GamePhase.END && !state.pendingDiscard) return;

    const p = this.me();
    if (!p) return;

    const cardIndex = p.hand.findIndex(c => c.id === cardId);
    if (cardIndex !== -1) {
      const card = p.hand.splice(cardIndex, 1)[0];
      p.graveyard.push(card);
      p.handCount = p.hand.length;
      p.graveyardCount = p.graveyard.length;

      // Connive Logic
      if (state.pendingDiscard && state.pendingDiscard.forConnive && state.pendingDiscard.triggerTargetId) {
        const isNonLand = !(card.type?.toLowerCase()?.includes('land') || card.type?.toLowerCase()?.includes('tierra'));
        if (isNonLand) {
          const connivingCreature = p.field.find(c => c.id === state.pendingDiscard!.triggerTargetId);
          if (connivingCreature) {
            connivingCreature.counters = connivingCreature.counters || {};
            connivingCreature.counters['+1/+1'] = (connivingCreature.counters['+1/+1'] || 0) + 1;
            this.notificationService.showToast('Maquinar Exitoso', `Descartaste ${card.name} (No-Tierra). ¡${connivingCreature.name} recibe un contador +1/+1!`, 'SUCCESS');
          }
        } else {
          this.notificationService.showToast('Maquinar', `Descartaste una tierra. No hay bonificación.`, 'INFO');
        }
      }

      if (state.pendingDiscard) {
        state.pendingDiscard.count -= 1;
        if (state.pendingDiscard.count <= 0) {
          state.pendingDiscard = undefined;
        }
      }

      this.updateState({});
    }
  }

  tapCard(cardId: string): void {
    const state = this.gameStateSubject.value;
    if (!state || this.isProcessing || state.pendingManaChoice || (state.pendingPayment && !state.pendingPayment.convokeActive)) return;
    
    // Handle Target Selection first
    if (state.pendingTarget) {
      this.handleTargetSelection(cardId);
      return;
    }

    const myId = this.userService.getCurrentUser()?.id?.toString();
    const isMyTurn = state.activePlayerId === myId;
    
    const p = this.me();
    const opp = this.opponent();
    if (!p || !opp) return;

    // --- SPRINT 9: INTERCEPTAR SELECCIÓN DE CRIATURAS PARA CONVOCAR ---
    if (state.pendingPayment?.convokeActive) {
      const payment = state.pendingPayment;
      const clickedCard = p.field.find(c => c.id === cardId);
      if (!clickedCard) return;

      const isCreature = (clickedCard.type || '').toLowerCase().includes('creature') || (clickedCard.type || '').toLowerCase().includes('criatura') || !!clickedCard.crewed;
      if (!isCreature) {
        this.notificationService.showToast('Selección inválida', 'Solo puedes convocar con criaturas.', 'WARNING');
        return;
      }
      if (clickedCard.isTapped) {
        this.notificationService.showToast('Selección inválida', 'La criatura seleccionada ya está girada.', 'WARNING');
        return;
      }

      // Tap the creature and track it
      this.isProcessing = true;
      clickedCard.isTapped = true;
      if (!payment.tappedConvokeCreatureIds) {
        payment.tappedConvokeCreatureIds = [];
      }
      payment.tappedConvokeCreatureIds.push(clickedCard.id);

      // Reduce the generic cost
      if (payment.remainingGeneric > 0) {
        payment.remainingGeneric--;
      }

      this.notificationService.showToast('Convocar', `${clickedCard.name} girada para reducir el coste del hechizo.`, 'SUCCESS');
      
      // Check if cost is fully paid now!
      if (payment.remainingGeneric === 0) {
        const cardIdToPlay = payment.cardId;
        this.finishPlayingCard(cardIdToPlay);
      } else {
        this.gameStateSubject.next({ ...state });
        this.isProcessing = false;
      }
      return;
    }

    // A. Interceptar selección de criaturas para tripular si hay una elección pendiente
    if (state.pendingCrewChoice) {
      const choice = state.pendingCrewChoice;
      const clickedCard = p.field.find(c => c.id === cardId);
      if (!clickedCard) return;

      const isCreature = (clickedCard.type || '').toLowerCase().includes('creature') || (clickedCard.type || '').toLowerCase().includes('criatura') || !!clickedCard.crewed;
      if (!isCreature) {
        this.notificationService.showToast('Selección inválida', 'Solo puedes tripular con criaturas.', 'WARNING');
        return;
      }
      if (clickedCard.isTapped) {
        this.notificationService.showToast('Selección inválida', 'La criatura seleccionada ya está girada.', 'WARNING');
        return;
      }
      if (clickedCard.id === choice.vehicleId) {
        this.notificationService.showToast('Selección inválida', 'Un vehículo no puede tripularse a sí mismo.', 'WARNING');
        return;
      }

      const index = choice.tappedCreatureIds.indexOf(clickedCard.id);
      if (index > -1) {
        choice.tappedCreatureIds.splice(index, 1);
      } else {
        choice.tappedCreatureIds.push(clickedCard.id);
      }
      this.gameStateSubject.next({ ...state });
      return;
    }

    // B. Interceptar selección de criaturas para sacrificar si hay una elección pendiente
    if (state.pendingSacrificeChoice) {
      const choice = state.pendingSacrificeChoice;
      if (choice.playerId !== myId) return; // Solo el propietario puede sacrificar
      
      const clickedCard = p.field.find(c => c.id === cardId);
      if (!clickedCard) return;

      const isCreature = (clickedCard.type || '').toLowerCase().includes('creature') || (clickedCard.type || '').toLowerCase().includes('criatura') || !!clickedCard.crewed;
      if (choice.validTypes === 'CREATURE' && !isCreature) {
        this.notificationService.showToast('Selección inválida', 'Solo puedes sacrificar criaturas.', 'WARNING');
        return;
      }

      this.resolveSacrifice(clickedCard.id);
      return;
    }

    const myCard = p.field.find(c => c.id === cardId);

    // 1. IF IT'S MY TURN
    if (isMyTurn) {
      if (!myCard) return;

      // Si es un Planeswalker, abrir la elección de habilidades de lealtad (Sprint 10)
      if (myCard.isPlaneswalker) {
        if (state.currentPhase === GamePhase.MAIN_1 || state.currentPhase === GamePhase.MAIN_2) {
          if (state.stack.length > 0) {
            this.notificationService.showToast('Velocidad de Conjuro', 'Solo puedes activar habilidades de lealtad cuando la pila está vacía.', 'WARNING');
            return;
          }
          if (myCard.loyaltyUsedThisTurn) {
            this.notificationService.showToast('Acción inválida', 'Solo puedes activar una habilidad de lealtad de este Planeswalker por turno.', 'WARNING');
            return;
          }
          
          state.pendingPlaneswalkerChoice = {
            planeswalkerId: myCard.id,
            abilities: this.getPlaneswalkerAbilitiesString(myCard)
          };
          this.gameStateSubject.next({ ...state });
          return;
        } else {
          this.notificationService.showToast('Velocidad de Conjuro', 'Las habilidades de lealtad solo se pueden activar durante tus fases principales.', 'WARNING');
          return;
        }
      }

      const type = (myCard.type || '').toLowerCase();
      const isEquipment = type.includes('equipment') || type.includes('equipo') || type.includes('artefacto - equipo');
      const isVehicle = type.includes('vehicle') || type.includes('vehículo') || type.includes('artefacto - vehículo');

      if (isEquipment) {
        const equipCost = this.parseEquipCost(myCard);
        const costReq = this.parseManaCost(equipCost);
        
        if (!this.canAffordParsed(costReq, p.manaPool)) {
          this.notificationService.showToast('Falta maná', `No tienes suficiente maná para equipar "${myCard.name}".`, 'WARNING');
          return;
        }
        
        state.pendingTarget = {
          sourceCardId: myCard.id,
          validTargets: 'CREATURE',
          effect: 'ATTACH_EQUIPMENT' as any,
        };
        this.notificationService.showToast('Equipar permanente', `Elige una criatura para equipar "${myCard.name}".`, 'INFO');
        this.gameStateSubject.next({ ...state });
        return;
      }

      // Si es un Vehículo y no está tripulado aún, iniciar proceso de tripular
      if (isVehicle && !myCard.crewed) {
        const requiredPower = this.parseCrewValue(myCard);
        state.pendingCrewChoice = {
          vehicleId: myCard.id,
          requiredPower: requiredPower,
          tappedCreatureIds: []
        };
        this.notificationService.showToast('Tripular Vehículo', `Elige criaturas enderezadas con fuerza total >= ${requiredPower} para tripular "${myCard.name}".`, 'INFO');
        this.gameStateSubject.next({ ...state });
        return;
      }

      if (state.currentPhase === GamePhase.COMBAT) {
        this.attackWithCard(myCard);
      } else {
        this.produceManaFromCard(myCard);
      }
    } 
    // 2. IF IT'S NOT MY TURN
    else {
      // If clicking my own card:
      if (myCard) {
        const isLand = myCard.type?.toLowerCase().includes('land') || myCard.type?.toLowerCase().includes('tierra');
        
        // In Combat: Creatures block, Lands still produce mana
        if (state.currentPhase === GamePhase.COMBAT && !isLand) {
          this.handleBlockingAction(cardId, p, opp);
        } else {
          // Anytime else (or if it's a land): produce mana
          this.produceManaFromCard(myCard);
        }
      }
      // If clicking opponent's card (only relevant during blocking assignment)
      else if (state.currentPhase === GamePhase.COMBAT) {
        this.handleBlockingAction(cardId, p, opp);
      }
    }
  }

  private handleTargetSelection(targetId: string): void {
    const state = this.gameStateSubject.value;
    if (!state || !state.pendingTarget) return;

    const isP1 = state.player1.id === targetId;
    const isP2 = state.player2.id === targetId;
    const targetType = (isP1 || isP2) ? 'PLAYER' : 'CREATURE';
    
    // Validation
    const req = state.pendingTarget.validTargets;
    if (req === 'CREATURE' && targetType !== 'CREATURE') {
      this.notificationService.showToast('Objetivo inválido', 'Debes elegir una criatura.', 'WARNING');
      return;
    }
    if (req === 'PLAYER' && targetType !== 'PLAYER') {
      this.notificationService.showToast('Objetivo inválido', 'Debes elegir un jugador.', 'WARNING');
      return;
    }

    if (targetType === 'CREATURE') {
      const p1 = state.player1;
      const p2 = state.player2;
      const targetCard = p1.field.find(c => c.id === targetId) || p2.field.find(c => c.id === targetId);
      
      if (targetCard) {
        const allCards = [...p1.hand, ...p1.field, ...p1.graveyard, ...p1.exile, ...p2.hand, ...p2.field, ...p2.graveyard, ...p2.exile];
        const sourceCard = allCards.find(c => c.id === state.pendingTarget?.sourceCardId);

        // 1. Shroud / Velo
        if (this.hasAbility(targetCard, 'shroud') || this.hasAbility(targetCard, 'velo')) {
          this.notificationService.showToast('Velo (Shroud)', `"${targetCard.name}" tiene Velo y no puede ser elegida como objetivo.`, 'WARNING');
          return;
        }

        // 2. Hexproof / Antimaleficio
        if (this.hasAbility(targetCard, 'hexproof') || this.hasAbility(targetCard, 'antimaleficio')) {
          const me = this.me();
          const targetOwner = p1.field.find(c => c.id === targetCard.id) ? p1 : p2;
          if (me && targetOwner.id !== me.id) {
            this.notificationService.showToast('Antimaleficio (Hexproof)', `"${targetCard.name}" tiene Antimaleficio y los oponentes no pueden seleccionarla como objetivo.`, 'WARNING');
            return;
          }
        }

        // 3. Protección
        if (sourceCard && this.hasProtectionFrom(targetCard, sourceCard)) {
          this.notificationService.showToast('Protección', `"${targetCard.name}" tiene protección contra el color de "${sourceCard.name}" y no puede ser su objetivo.`, 'WARNING');
          return;
        }

        // 4. Ward / Amparo (Nuevo)
        if (this.hasAbility(targetCard, 'ward') || this.hasAbility(targetCard, 'amparo')) {
          const me = this.me();
          const targetOwner = p1.field.find(c => c.id === targetCard.id) ? p1 : p2;
          if (me && targetOwner.id !== me.id) {
            const wardCost = this.parseWardCost(targetCard);
            if (wardCost.length > 0) {
              this.gameStateSubject.next({
                ...state,
                pendingWardChoice: {
                  targetCardId: targetCard.id,
                  sourceCardId: state.pendingTarget!.sourceCardId,
                  wardCost,
                  selectedTargetId: targetId,
                  selectedTargetType: 'CREATURE'
                }
              });
              this.notificationService.showToast('Amparo (Ward)', `"${targetCard.name}" tiene Amparo. Debes pagar el coste adicional de ${wardCost.join(', ')} para designarla como objetivo.`, 'WARNING');
              return;
            }
          }
        }
      }
    }

    this.executeTargetEffect(targetId, targetType);
  }

  private executeTargetEffect(targetId: string, targetType: 'CREATURE' | 'PLAYER' | 'SPELL_ON_STACK'): void {
    const state = this.gameStateSubject.value;
    if (!state || !state.pendingTarget) return;

    this.selectedTargetId = targetId;
    this.selectedTargetType = targetType;

    const sourceCardId = state.pendingTarget.sourceCardId;

    if (this.pendingChannelStackItem && this.pendingChannelStackItem.sourceCardId === sourceCardId) {
      const item = this.pendingChannelStackItem;
      this.pendingChannelStackItem = undefined;
      item.targetId = targetId;
      item.targetType = targetType as any;
      
      const newStack = [...state.stack, item];
      state.pendingTarget = undefined;
      this.updateState({
        stack: newStack,
        passedCount: 0
      }, true, () => {
        this.isProcessing = false;
      });
      return;
    }

    state.pendingTarget = undefined; 
    this.finishPlayingCard(sourceCardId);
  }

  targetPlayer(playerId: string): void {
    const state = this.gameStateSubject.value;
    if (state?.pendingTarget) {
      this.handleTargetSelection(playerId);
    }
  }


  public attackWithCard(card: GameCard, targetId?: string): void {
    const state = this.gameStateSubject.value;
    if (!state) return;

    const isCreature = (card.type || '').toLowerCase().includes('creature') || (card.type || '').toLowerCase().includes('criatura') || !!card.crewed;
    if (!isCreature) {
      this.notificationService.showToast('Acción inválida', 'Solo las criaturas y vehículos tripulados pueden atacar.', 'INFO');
      return;
    }

    if (this.hasAbility(card, 'defender') || this.hasAbility(card, 'defensor')) {
      this.notificationService.showToast('Defensor (Defender)', `"${card.name}" tiene Defensor y no puede atacar.`, 'WARNING');
      return;
    }

    if (card.isTapped && !card.isAttacking) {
      this.notificationService.showToast('Acción inválida', 'Una criatura girada no puede atacar.', 'INFO');
      return;
    }

    // Summoning Sickness check
    const hasHaste = this.hasAbility(card, 'haste') || this.hasAbility(card, 'prisa');
    if (card.enteredFieldTurn === state.turnCount && !hasHaste) {
      this.notificationService.showToast('Mareo de invocación', 'Esta criatura acaba de llegar, no puede atacar todavía.', 'WARNING');
      return;
    }

    this.isProcessing = true;
    const opp = state.player1.id === state.activePlayerId ? state.player2 : state.player1;

    if (card.isAttacking) {
      // Un-declare attacker
      card.isAttacking = false;
      card.attackingTargetId = undefined;
      const hasVigilance = this.hasAbility(card, 'vigilance') || this.hasAbility(card, 'vigilancia');
      if (!hasVigilance) card.isTapped = false;
    } else {
      // Declare attacker
      card.isAttacking = true;
      card.attackingTargetId = targetId || opp.id;
      const hasVigilance = this.hasAbility(card, 'vigilance') || this.hasAbility(card, 'vigilancia');
      if (!hasVigilance) card.isTapped = true;
    }

    this.updateState({}, true, () => {
      this.isProcessing = false;
    });
  }

  private handleBlockingAction(cardId: string, me: PlayerGameState, opp: PlayerGameState): void {
    this.isProcessing = true;
    // 1. Check if clicking my own card to select it as a blocker
    const myCard = me.field.find(c => c.id === cardId);
    if (myCard) {
      const isCreature = (myCard.type || '').toLowerCase().includes('creature') || (myCard.type || '').toLowerCase().includes('criatura') || !!myCard.crewed;
      if (!isCreature) {
        this.notificationService.showToast('Acción inválida', 'Solo las criaturas y vehículos tripulados pueden bloquear.', 'WARNING');
        this.isProcessing = false;
        return;
      }

      if (myCard.isTapped) {
        this.notificationService.showToast('Acción inválida', 'Una criatura girada no puede bloquear.', 'INFO');
        this.isProcessing = false;
        return;
      }
      
      // SPRINT 14: Decayed
      if (this.hasAbility(myCard, 'decayed') || this.hasAbility(myCard, 'descompuesto')) {
        this.notificationService.showToast('Descompuesto', 'Una criatura con Decayed no puede bloquear.', 'WARNING');
        this.isProcessing = false;
        return;
      }
      // Toggle selection for blocking
      if (myCard.isBlocking) {
        myCard.isBlocking = false;
      } else {
        // Select this card as the current "active" blocker
        // We DON'T clear others anymore, just toggle this one
        myCard.isBlocking = true;
        this.notificationService.showToast('Bloqueador', `Selecciona qué atacante bloquea ${myCard.name}`, 'INFO');
      }
      this.updateState({}, true, () => {
        this.isProcessing = false;
      });
      return;
    }

    // 2. Check if clicking an opponent's attacker to assign the selected blocker
    const selectedBlocker = me.field.find(c => c.isBlocking);
    const opponentAttacker = opp.field.find(c => c.id === cardId && c.isAttacking);

    if (selectedBlocker && opponentAttacker) {
      // VALIDATION: UNBLOCKABLE
      const isUnblockable = this.hasAbility(opponentAttacker, 'unblockable') || this.hasAbility(opponentAttacker, 'imbloqueable') || opponentAttacker.tempUnblockable;
      if (isUnblockable) {
        this.notificationService.showToast('No puede bloquear', `${opponentAttacker.name} es imbloqueable.`, 'WARNING');
        this.isProcessing = false;
        return;
      }

      // VALIDATION: PROTECTION
      if (this.hasProtectionFrom(opponentAttacker, selectedBlocker)) {
        this.notificationService.showToast('No puede bloquear', `${opponentAttacker.name} tiene protección contra el color de ${selectedBlocker.name}.`, 'WARNING');
        this.isProcessing = false;
        return;
      }

      // VALIDATION: FLYING / REACH
      const attackerHasFlying = this.hasAbility(opponentAttacker, 'flying') || this.hasAbility(opponentAttacker, 'vuela');
      const blockerHasFlying = this.hasAbility(selectedBlocker, 'flying') || this.hasAbility(selectedBlocker, 'vuela');
      const blockerHasReach = this.hasAbility(selectedBlocker, 'reach') || this.hasAbility(selectedBlocker, 'alcance');

      if (attackerHasFlying && !blockerHasFlying && !blockerHasReach) {
        this.notificationService.showToast('No puede bloquear', `${opponentAttacker.name} vuela y no tienes Alcance.`, 'WARNING');
        this.isProcessing = false;
        return;
      }

      // --- SPRINT 9: EVASIÓN COMPLEJA ("Can't be blocked except by...") ---
      const attackerText = (opponentAttacker.oracleText || '').toLowerCase();
      if (attackerText.includes("can't be blocked except by") || attackerText.includes("no puede ser bloqueada excepto por") || attackerText.includes("no puede ser bloqueado excepto por")) {
        if ((attackerText.includes("flying") || attackerText.includes("volar")) && !blockerHasFlying) {
          this.notificationService.showToast('No puede bloquear', `${opponentAttacker.name} solo puede ser bloqueado por criaturas con Volar.`, 'WARNING');
          this.isProcessing = false;
          return;
        }
        if ((attackerText.includes("reach") || attackerText.includes("alcance")) && !blockerHasFlying && !blockerHasReach) {
          this.notificationService.showToast('No puede bloquear', `${opponentAttacker.name} solo puede ser bloqueado por criaturas con Alcance o Volar.`, 'WARNING');
          this.isProcessing = false;
          return;
        }
      }

      selectedBlocker.blockingTargetId = opponentAttacker.id;
      selectedBlocker.isBlocking = false; // Finished assigning this one
      this.notificationService.showToast('Bloqueo asignado', `${selectedBlocker.name} bloquea a ${opponentAttacker.name}`, 'SUCCESS');
      
      // Hint for Menace
      const hasMenace = this.hasAbility(opponentAttacker, 'menace') || this.hasAbility(opponentAttacker, 'menaza');
      if (hasMenace) {
        const currentBlockers = me.field.filter(c => c.blockingTargetId === opponentAttacker.id).length;
        if (currentBlockers < 2) {
          this.notificationService.showToast('Menaza', `${opponentAttacker.name} tiene Menaza. Necesitas al menos otro bloqueador.`, 'INFO');
        }
      }

      this.updateState({}, true, () => {
        this.isProcessing = false;
      });
    } else {
      this.isProcessing = false;
    }
  }

  private getCardColors(card: GameCard): string[] {
    const colors: string[] = [];
    if (!card.manaCost) return colors;
    
    card.manaCost.forEach(s => {
      const v = s.toUpperCase().replace(/{|}/g, '');
      if (v.includes('W') && !colors.includes('white')) colors.push('white');
      if (v.includes('U') && !colors.includes('blue')) colors.push('blue');
      if (v.includes('B') && !colors.includes('black')) colors.push('black');
      if (v.includes('R') && !colors.includes('red')) colors.push('red');
      if (v.includes('G') && !colors.includes('green')) colors.push('green');
    });
    return colors;
  }

  public hasProtectionFrom(target: GameCard, source: GameCard): boolean {
    const text = (target.oracleText || '').toLowerCase();
    const sourceColors = this.getCardColors(source);
    
    const protectionRegex = /(?:protection from|protección contra) (white|blue|black|red|green|blanco|azul|negro|rojo|verde)/gi;
    let match;
    while ((match = protectionRegex.exec(text)) !== null) {
      const colorWord = match[1].toLowerCase();
      let englishColor = colorWord;
      if (colorWord === 'blanco') englishColor = 'white';
      else if (colorWord === 'azul') englishColor = 'blue';
      else if (colorWord === 'negro') englishColor = 'black';
      else if (colorWord === 'rojo') englishColor = 'red';
      else if (colorWord === 'verde') englishColor = 'green';
      
      if (sourceColors.includes(englishColor)) {
        return true;
      }
    }
    return false;
  }

  private parseFlashbackCost(card: GameCard): string[] {
    const text = (card.oracleText || '').toLowerCase();
    const flashbackMatch = text.match(/flashback\s+({[^{}]+}+)/i);
    if (flashbackMatch) {
      const costStr = flashbackMatch[1];
      const symbols = costStr.match(/{[^{}]+}/g) || [];
      return symbols;
    }
    const escapeMatch = text.match(/escape—({[^{}]+}+)/i);
    if (escapeMatch) {
      const costStr = escapeMatch[1];
      const symbols = costStr.match(/{[^{}]+}/g) || [];
      return symbols;
    }
    return card.manaCost || [];
  }

  private parseDisturbCost(card: GameCard): string[] {
    if (card.disturbCost && card.disturbCost.length > 0) {
      return card.disturbCost;
    }
    const text = (card.oracleText || '').toLowerCase();
    const disturbMatch = text.match(/disturb\s+({[^{}]+}+)/i) || text.match(/perturbar\s+({[^{}]+}+)/i);
    if (disturbMatch) {
      const costStr = disturbMatch[1];
      const symbols = costStr.match(/{[^{}]+}/g) || [];
      return symbols;
    }
    return card.manaCost || [];
  }

  private parseCyclingCost(card: GameCard): string[] {
    const text = (card.oracleText || '').toLowerCase();
    const cyclingMatch = text.match(/cycling\s+({[^{}]+}+)/i);
    if (cyclingMatch) {
      const costStr = cyclingMatch[1];
      const symbols = costStr.match(/{[^{}]+}/g) || [];
      return symbols;
    }
    return ['{2}'];
  }

  private parseKickerCost(card: GameCard): string[] {
    const text = (card.oracleText || '').toLowerCase();
    const kickerMatch = text.match(/kicker\s+({[^{}]+}+)/i);
    if (kickerMatch) {
      const costStr = kickerMatch[1];
      const symbols = costStr.match(/{[^{}]+}/g) || [];
      return symbols;
    }
    return [];
  }

  private parseEquipCost(card: GameCard): string[] {
    const text = (card.oracleText || '').toLowerCase();
    const equipMatch = text.match(/equip\s+({[^{}]+}+)/i);
    if (equipMatch) {
      const costStr = equipMatch[1];
      const symbols = costStr.match(/{[^{}]+}/g) || [];
      return symbols;
    }
    return ['{2}'];
  }

  chooseKicker(payKicker: boolean): void {
    const state = this.gameStateSubject.value;
    if (!state || !state.pendingKickerChoice) return;
    this.isProcessing = true;

    const p = this.me();
    if (!p) {
      this.isProcessing = false;
      return;
    }

    const cardId = state.pendingKickerChoice.cardId;
    const kickerCost = state.pendingKickerChoice.kickerCost;
    state.pendingKickerChoice = undefined;

    const cardIndex = p.hand.findIndex(c => c.id === cardId);
    if (cardIndex === -1) {
      this.isProcessing = false;
      return;
    }
    const card = p.hand[cardIndex];

    let costReqSymbols = card.manaCost || [];
    if (payKicker) {
      costReqSymbols = [...costReqSymbols, ...kickerCost];
    }

    const costReq = this.parseManaCost(costReqSymbols);
    if (!this.canAffordParsed(costReq, p.manaPool)) {
      this.notificationService.showToast('Falta maná', `No tienes suficiente maná para pagar el coste ${payKicker ? 'con Estímulo ' : ''}de "${card.name}".`, 'WARNING');
      this.isProcessing = false;
      return;
    }

    this.paySpecificCosts(costReq, p.manaPool);

    this.kickedNextCast = payKicker;

    const effect = this.parseCardEffect(card);
    const isSpell = this.isSpell(card);

    if (isSpell && effect && effect.needsTarget && !state.pendingTarget) {
      state.pendingTarget = {
        sourceCardId: card.id,
        validTargets: effect.validTargets,
        effect: effect.effect,
        value: effect.value
      };
      this.notificationService.showToast('Selecciona objetivo', `Elige un objetivo para ${card.name}`, 'INFO');
      this.gameStateSubject.next({ ...state });
      this.isProcessing = false;
      return;
    }

    const stackItem: StackItem = {
      id: Math.random().toString(36).substr(2, 9),
      sourceCardId: card.id,
      controllerId: p.id,
      type: 'SPELL',
      name: card.name,
      card: { ...card },
      imageUrl: card.imageUrl,
      effect: effect,
      kicked: payKicker,
      targetId: state.pendingTarget?.sourceCardId === card.id ? this.selectedTargetId : undefined,
      targetType: state.pendingTarget?.sourceCardId === card.id ? this.selectedTargetType : undefined
    };

    p.hand.splice(cardIndex, 1);
    p.handCount = p.hand.length;

    const newStack = [...state.stack, stackItem];
    this.kickedNextCast = false;

    this.updateState({ 
      stack: newStack,
      passedCount: 0 
    }, true, () => {
      this.isProcessing = false;
    });
  }

  chooseWard(payWard: boolean): void {
    const state = this.gameStateSubject.value;
    if (!state || !state.pendingWardChoice) return;
    this.isProcessing = true;

    const choice = state.pendingWardChoice;
    const me = this.me();
    if (!me) {
      this.isProcessing = false;
      return;
    }

    if (payWard) {
      const costReq = this.parseManaCost(choice.wardCost);
      if (!this.canAffordParsed(costReq, me.manaPool)) {
        this.notificationService.showToast('Maná insuficiente', 'No tienes suficiente maná para pagar el amparo (Ward).', 'ERROR');
        this.cancelTargetSelection();
        this.isProcessing = false;
        return;
      }
      this.paySpecificCosts(costReq, me.manaPool);
      this.notificationService.showToast('Amparo pagado', 'Has pagado el amparo y se ha completado el objetivo.', 'SUCCESS');

      // Clear pendingWardChoice and proceed
      const nextState = { ...state };
      delete nextState.pendingWardChoice;
      this.gameStateSubject.next(nextState);

      this.isProcessing = false;
      this.executeTargetEffect(choice.selectedTargetId, choice.selectedTargetType);
    } else {
      this.notificationService.showToast('Amparo rehusado', 'Has rehusado pagar el amparo. El hechizo se ha cancelado.', 'WARNING');
      this.cancelTargetSelection();
      this.isProcessing = false;
    }
  }

  cancelTargetSelection(): void {
    const state = this.gameStateSubject.value;
    if (!state) return;

    const nextState = { ...state };
    delete nextState.pendingTarget;
    delete nextState.pendingWardChoice;
    delete nextState.pendingKickerChoice;
    delete nextState.pendingPayment;
    
    this.gameStateSubject.next(nextState);
    this.updateState({});
  }

  parseWardCost(card: GameCard): string[] {
    const text = (card.oracleText || '').toLowerCase();
    const match = text.match(/(?:ward|amparo)\s+{([^}]+)}/i);
    if (match) {
      const costStr = match[1].toUpperCase();
      return [costStr];
    }
    return [];
  }

  playCardFromGraveyard(cardId: string): void {
    const state = this.gameStateSubject.value;
    if (!state || this.isProcessing || state.pendingManaChoice || state.pendingPayment) return;
    this.isProcessing = true;

    const p = this.me();
    if (!p) {
      this.isProcessing = false;
      return;
    }

    const cardIndex = p.graveyard.findIndex(c => c.id === cardId);
    if (cardIndex === -1) {
      this.isProcessing = false;
      return;
    }
    const card = p.graveyard[cardIndex];
    const isFast = this.isFastCard(card);
    
    const myId = this.userService.getCurrentUser()?.id?.toString();
    if (state?.activePlayerId !== myId && !isFast) {
      this.notificationService.showToast('Acción inválida', 'Solo puedes jugar Instantáneos o cartas con Destello fuera de tu turno.', 'WARNING');
      this.isProcessing = false;
      return;
    }

    const isMainPhase = state.currentPhase === GamePhase.MAIN_1 || state.currentPhase === GamePhase.MAIN_2;
    if (!isMainPhase && !isFast) {
      this.notificationService.showToast('Fase incorrecta', 'Solo puedes jugar esta carta en tus fases principales.', 'WARNING');
      this.isProcessing = false;
      return;
    }

    const text = (card.oracleText || '').toLowerCase();
    const hasFlashback = text.includes('flashback');
    const hasEscape = text.includes('escape');
    const hasDisturb = text.includes('disturb') || text.includes('perturbar') || card.hasDisturb;

    if (!hasFlashback && !hasEscape && !hasDisturb) {
      this.notificationService.showToast('Acción no permitida', 'Esta carta no se puede lanzar desde el cementerio.', 'WARNING');
      this.isProcessing = false;
      return;
    }

    if (hasEscape) {
      const otherGraveCards = p.graveyard.filter(c => c.id !== cardId);
      if (otherGraveCards.length < 2) {
        this.notificationService.showToast('Escape fallido', 'Necesitas exiliar otras 2 cartas de tu cementerio para escapar.', 'WARNING');
        this.isProcessing = false;
        return;
      }
      for (let i = 0; i < 2; i++) {
        const toExile = otherGraveCards[i];
        p.graveyard = p.graveyard.filter(c => c.id !== toExile.id);
        this.exileCard(toExile.id, p.id);
      }
    }

    const costReq = hasDisturb
      ? this.parseManaCost(this.parseDisturbCost(card))
      : this.parseManaCost(this.parseFlashbackCost(card));

    if (!this.canAffordParsed(costReq, p.manaPool)) {
      const typeStr = hasDisturb ? 'Perturbar' : 'Flashback/Escape';
      this.notificationService.showToast('Falta maná', `No tienes suficiente maná para pagar el coste de ${typeStr} de "${card.name}".`, 'WARNING');
      this.isProcessing = false;
      return;
    }

    this.paySpecificCosts(costReq, p.manaPool);

    const effect = this.parseCardEffect(card);
    const isSpell = this.isSpell(card);

    if (isSpell && effect && effect.needsTarget && !state.pendingTarget) {
      state.pendingTarget = {
        sourceCardId: card.id,
        validTargets: effect.validTargets,
        effect: effect.effect,
        value: effect.value
      };
      this.notificationService.showToast('Selecciona objetivo', `Elige un objetivo para ${card.name}`, 'INFO');
      this.gameStateSubject.next({ ...state });
      this.isProcessing = false;
      return;
    }

    // Si es Disturb, la carta se castea transformada
    const stackCard = { ...card };
    if (hasDisturb) {
      stackCard.currentFaceIndex = 1;
      stackCard.disturbExileOnLeave = true;
      stackCard.exileOnResolution = true;
      
      // Simular transformación a Espíritu
      stackCard.name = `Espíritu de ${card.name}`;
      stackCard.type = 'Creature — Spirit';
      stackCard.power = ((parseInt(String(card.power)) || 2) + 1).toString();
      stackCard.toughness = ((parseInt(String(card.toughness)) || 2) + 1).toString();
      stackCard.oracleText = `${card.oracleText || ''}\nVuela.\nSi fuera a ir al cementerio desde cualquier parte, en su lugar exíliala.`;
    } else {
      stackCard.exileOnResolution = true;
    }

    const stackItem: StackItem = {
      id: Math.random().toString(36).substr(2, 9),
      sourceCardId: card.id,
      controllerId: p.id,
      type: 'SPELL',
      name: stackCard.name,
      card: stackCard,
      imageUrl: card.imageUrl,
      effect: effect,
      targetId: state.pendingTarget?.sourceCardId === card.id ? this.selectedTargetId : undefined,
      targetType: state.pendingTarget?.sourceCardId === card.id ? this.selectedTargetType : undefined
    };

    p.graveyard = p.graveyard.filter(c => c.id !== cardId);
    p.graveyardCount = p.graveyard.length;

    const newStack = [...state.stack, stackItem];
    state.pendingPayment = undefined;
    state.pendingTarget = undefined;

    this.updateState({ 
      stack: newStack,
      passedCount: 0 
    }, true, () => {
      this.isProcessing = false;
    });
  }

  cycleCard(cardId: string): void {
    const state = this.gameStateSubject.value;
    if (!state || this.isProcessing) return;
    this.isProcessing = true;

    const p = this.me();
    if (!p) {
      this.isProcessing = false;
      return;
    }

    const cardIndex = p.hand.findIndex(c => c.id === cardId);
    if (cardIndex === -1) {
      this.isProcessing = false;
      return;
    }
    const card = p.hand[cardIndex];
    
    const text = (card.oracleText || '').toLowerCase();
    if (!text.includes('cycling') && !text.includes('ciclo')) {
      this.notificationService.showToast('Acción inválida', 'Esta carta no tiene Ciclo.', 'WARNING');
      this.isProcessing = false;
      return;
    }

    const costReq = this.parseManaCost(this.parseCyclingCost(card));
    if (!this.canAffordParsed(costReq, p.manaPool)) {
      this.notificationService.showToast('Falta maná', `No tienes maná suficiente para ciclar "${card.name}".`, 'WARNING');
      this.isProcessing = false;
      return;
    }

    this.paySpecificCosts(costReq, p.manaPool);
    
    p.hand.splice(cardIndex, 1);
    p.handCount = p.hand.length;
    p.graveyard.push(card);
    p.graveyardCount = p.graveyard.length;

    this.drawCardToPlayer(p);

    this.updateState({}, true, () => {
      this.isProcessing = false;
      this.notificationService.showToast('Ciclo', `Has ciclado ${card.name} y robado 1 carta.`, 'SUCCESS');
    });
  }

  hasAbility(card: GameCard, ability: string): boolean {
    const text = (card.oracleText || '').toLowerCase();
    const type = (card.type || '').toLowerCase();
    const name = (card.name || '').toLowerCase();
    
    const a = ability.toLowerCase().trim();
    
    // Comprobar si la propia carta posee la habilidad en su texto
    const hasOwn = () => {
      if (a === 'haste' || a === 'prisa') return text.includes('haste') || text.includes('prisa');
      if (a === 'vigilance' || a === 'vigilancia') return text.includes('vigilance') || text.includes('vigilancia');
      if (a === 'lifelink' || a === 'vínculo vital' || a === 'vinculo vital') return text.includes('lifelink') || text.includes('vínculo vital') || text.includes('vinculo vital');
      if (a === 'deathtouch' || a === 'toque mortal') return text.includes('deathtouch') || text.includes('toque mortal');
      if (a === 'trample' || a === 'arrollar') return text.includes('trample') || text.includes('arrollar');
      if (a === 'indestructible') return text.includes('indestructible');
      if (a === 'flying' || a === 'vuela' || a === 'volar') return text.includes('flying') || text.includes('vuela') || text.includes('volar') || type.includes('flying') || type.includes('vuela');
      if (a === 'reach' || a === 'alcance') return text.includes('reach') || text.includes('alcance');
      if (a === 'first strike' || a === 'dañar primero' || a === 'danar primero') return text.includes('first strike') || text.includes('dañar primero') || text.includes('danar primero');
      if (a === 'double strike' || a === 'dañar dos veces' || a === 'danar dos veces') return text.includes('double strike') || text.includes('dañar dos veces') || text.includes('danar dos veces');
      if (a === 'unblockable' || a === 'imbloqueable') return text.includes('unblockable') || text.includes('imbloqueable') || text.includes('no puede ser bloqueada') || text.includes('no puede ser bloqueado');
      if (a === 'menace' || a === 'menaza') return text.includes('menace') || text.includes('menaza');
      if (a === 'ward' || a === 'amparo') return text.includes('ward') || text.includes('amparo');
      if (a === 'defender' || a === 'defensor') return text.includes('defender') || text.includes('defensor');
      if (a === 'hexproof' || a === 'antimaleficio') return text.includes('hexproof') || text.includes('antimaleficio');
      if (a === 'shroud' || a === 'velo') return text.includes('shroud') || text.includes('velo');
      if (a === 'protection' || a === 'protección' || a === 'proteccion') return text.includes('protection') || text.includes('protección') || text.includes('proteccion');
      if (a === 'flash' || a === 'destello') return text.includes('flash') || text.includes('destello');
      return false;
    };

    if (hasOwn()) return true;

    // Comprobar si es concedida por Auras/Equipamiento anexados
    const state = this.gameStateSubject.value;
    if (state && card.attachedCardIds && card.attachedCardIds.length > 0) {
      const allFieldCards = [
        ...(state.player1?.field || []),
        ...(state.player2?.field || [])
      ];

      const spanishAbilityMap: { [key: string]: string[] } = {
        'haste': ['prisa'],
        'prisa': ['haste', 'prisa'],
        'vigilance': ['vigilancia'],
        'vigilancia': ['vigilance', 'vigilancia'],
        'lifelink': ['vínculo vital', 'vinculo vital'],
        'vínculo vital': ['lifelink', 'vínculo vital', 'vinculo vital'],
        'vinculo vital': ['lifelink', 'vínculo vital', 'vinculo vital'],
        'deathtouch': ['toque mortal'],
        'toque mortal': ['deathtouch', 'toque mortal'],
        'trample': ['arrollar'],
        'arrollar': ['trample', 'arrollar'],
        'flying': ['vuela', 'volar'],
        'vuela': ['flying', 'vuela', 'volar'],
        'volar': ['flying', 'vuela', 'volar'],
        'reach': ['alcance'],
        'alcance': ['reach', 'alcance'],
        'first strike': ['dañar primero', 'danar primero'],
        'dañar primero': ['first strike', 'dañar primero', 'danar primero'],
        'danar primero': ['first strike', 'dañar primero', 'danar primero'],
        'double strike': ['dañar dos veces', 'danar dos veces'],
        'dañar dos veces': ['double strike', 'dañar dos veces', 'danar dos veces'],
        'danar dos veces': ['double strike', 'dañar dos veces', 'danar dos veces'],
        'unblockable': ['imbloqueable'],
        'imbloqueable': ['unblockable', 'imbloqueable'],
        'menace': ['menaza'],
        'menaza': ['menace', 'menaza'],
        'ward': ['amparo'],
        'amparo': ['ward', 'amparo'],
        'defender': ['defensor'],
        'defensor': ['defender', 'defensor'],
        'hexproof': ['antimaleficio'],
        'antimaleficio': ['hexproof', 'antimaleficio'],
        'shroud': ['velo'],
        'velo': ['shroud', 'velo'],
        'protection': ['protección', 'proteccion'],
        'protección': ['protection', 'protección', 'proteccion'],
        'proteccion': ['protection', 'protección', 'proteccion'],
        'flash': ['destello'],
        'destello': ['flash', 'destello']
      };

      const searchAbilities = [a];
      if (spanishAbilityMap[a]) {
        searchAbilities.push(...spanishAbilityMap[a]);
      }

      for (const attId of card.attachedCardIds) {
        const attCard = allFieldCards.find(c => c.id === attId);
        if (attCard) {
          const attText = (attCard.oracleText || '').toLowerCase();
          for (const ab of searchAbilities) {
            const englishPattern = new RegExp(`(?:equipped|enchanted)\\s+creature\\s+(?:has|gets|gains)\\s+${ab}`, 'i');
            const spanishPattern = new RegExp(`la\\s+criatura\\s+(?:equipada|encantada)\\s+(?:tiene|obtiene|gana)\\s+${ab}`, 'i');
            if (englishPattern.test(attText) || spanishPattern.test(attText)) {
              return true;
            }
          }
        }
      }
    }

    return false;
  }

  private produceManaFromCard(card: GameCard): void {
    const state = this.gameStateSubject.value;
    if (!state) return;
    const p = this.me();
    if (!p) return;

    if (card.isTapped) {
      this.notificationService.showToast('Acción inválida', 'La carta ya está girada.', 'INFO');
      return;
    }

    // Summoning Sickness check for non-lands
    const isLand = card.type?.toLowerCase().includes('land') || card.type?.toLowerCase().includes('tierra');
    const hasHaste = this.hasAbility(card, 'haste') || this.hasAbility(card, 'prisa');
    if (!isLand && card.enteredFieldTurn === state.turnCount && !hasHaste) {
      this.notificationService.showToast('Mareo de invocación', 'Esta criatura no puede activar habilidades todavía.', 'WARNING');
      return;
    }

    this.isProcessing = true;
    card.isTapped = true;
    
    const produced = card.producedMana || [];
    if (produced.length > 1) {
      state.pendingManaChoice = {
        playerId: p.id,
        cardId: card.id,
        options: produced
      };
      this.gameStateSubject.next({ ...state });
      this.updateState({}, true); // Keep isProcessing = true
    } else {
      const manaType = produced.length === 1 ? this.mapColorToPoolKey(produced[0]) : this.getManaType(card);
      if (manaType) {
        (p.manaPool as any)[manaType]++;
      }
      this.updateState({}, true, () => {
        this.isProcessing = false;
      });
    }
  }

  resolveManaChoice(color: string): void {
    const state = this.gameStateSubject.value;
    if (!state || !state.pendingManaChoice) return;

    const p = this.me();
    if (!p) return;

    const manaType = this.mapColorToPoolKey(color);
    if (manaType) {
      (p.manaPool as any)[manaType]++;
      console.log(`Choice resolved: ${manaType}. New pool:`, { ...p.manaPool });
    }

    state.pendingManaChoice = undefined;
    // Local update to hide overlay
    this.gameStateSubject.next({ ...state });
    this.updateState({}, true, () => {
      this.isProcessing = false;
    });
  }

  private mapColorToPoolKey(color: string): keyof ManaPool | null {
    const c = color.toUpperCase();
    if (c === 'W') return 'white';
    if (c === 'U') return 'blue';
    if (c === 'B') return 'black';
    if (c === 'R') return 'red';
    if (c === 'G') return 'green';
    if (c === 'C') return 'colorless';
    return null;
  }

  private createEmptyManaPool(): any {
    return { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 };
  }

  private clearManaPools(): void {
    const state = this.gameStateSubject.value;
    if (!state) return;
    state.player1.manaPool = this.createEmptyManaPool();
    state.player2.manaPool = this.createEmptyManaPool();
    this.updateState({});
  }

  private getManaType(card: GameCard): keyof ManaPool | null {
    const typeLine = (card.type || '').toLowerCase();
    const name = (card.name || '').toLowerCase();
    
    if (typeLine.includes('forest') || name.includes('bosque')) return 'green';
    if (typeLine.includes('island') || name.includes('isla')) return 'blue';
    if (typeLine.includes('mountain') || name.includes('montaña')) return 'red';
    if (typeLine.includes('swamp') || name.includes('pantano')) return 'black';
    if (typeLine.includes('plains') || name.includes('llanura')) return 'white';
    
    if (typeLine.includes('land') || typeLine.includes('tierra')) return 'colorless';
    return null;
  }

  public updateState(patch: Partial<GameState>, sync: boolean = true, onComplete?: () => void): void {
    const current = this.gameStateSubject.value;
    if (current) {
      let newState = { ...current, ...patch };
      
      // Check for Game Over before syncing
      newState = this.checkGameOver(newState);

      this.gameStateSubject.next(newState);
      if (sync) {
        this.battleService.pushState(newState.matchId, newState).subscribe({
          next: () => { 
            console.log("✅ Sync OK");
            if (onComplete) onComplete(); 
          },
          error: (err) => { 
            console.error("❌ Sync Error:", err);
            if (err.status === 401) {
              this.notificationService.showToast('Sesión Expirada', 'Tu sesión no es válida. Por favor, haz login de nuevo.', 'ERROR');
            }
            if (onComplete) onComplete(); 
          }
        });
      } else if (onComplete) {
        onComplete();
      }
    } else if (onComplete) {
      onComplete();
    }
  }

  private checkGameOver(state: GameState): GameState {
    if (state.winnerId) return state; // Already over

    const p1Poison = state.player1.poisonCounters || 0;
    const p2Poison = state.player2.poisonCounters || 0;

    const p1Dead = state.player1.hp <= 0 || p1Poison >= 10;
    const p2Dead = state.player2.hp <= 0 || p2Poison >= 10;

    if (p1Dead && p2Dead) {
      state.winnerId = 'DRAW'; 
      this.notificationService.showToast('¡Empate!', 'Ambos jugadores han sido derrotados.', 'INFO');
    } else if (p1Dead) {
      state.winnerId = state.player2.id;
      const cause = p1Poison >= 10 ? 'por envenenamiento' : 'por falta de vida';
      this.notificationService.showToast('¡Partida terminada!', `Ganador: ${state.player2.username} (${cause})`, 'SUCCESS');
    } else if (p2Dead) {
      state.winnerId = state.player1.id;
      const cause = p2Poison >= 10 ? 'por envenenamiento' : 'por falta de vida';
      this.notificationService.showToast('¡Partida terminada!', `Ganador: ${state.player1.username} (${cause})`, 'SUCCESS');
    }
    return state;
  }

  refreshGameState(): void {
    const state = this.gameStateSubject.value;
    if (state) {
      this.pollState(state.matchId);
    }
  }

  resetLives(): void {
    const state = this.gameStateSubject.value;
    if (!state) return;
    state.player1.hp = 20;
    state.player2.hp = 20;
    this.updateState({ player1: state.player1, player2: state.player2 }, true);
    this.notificationService.showToast('Debug', 'Vidas reseteadas a 20.', 'INFO');
  }

  private shuffle(array: any[]): void {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private resolveCombat(): boolean {
    const state = this.gameStateSubject.value;
    if (!state) return false;

    const activePlayer = state.player1.id === state.activePlayerId ? state.player1 : state.player2;
    const defendingPlayer = state.player1.id === state.activePlayerId ? state.player2 : state.player1;

    const attackers = activePlayer.field.filter(c => c.isAttacking);
    console.log(`⚔️ Resolviendo combate: ${attackers.length} atacantes encontrados.`);
    if (attackers.length === 0) return false;

    // 1. Validate Menace and other illegal blocks
    attackers.forEach(attacker => {
      const blockers = defendingPlayer.field.filter(c => c.blockingTargetId === attacker.id);
      const hasMenace = this.hasAbility(attacker, 'menace') || this.hasAbility(attacker, 'menaza');
      if (hasMenace && blockers.length === 1) {
         blockers.forEach(b => {
           b.blockingTargetId = undefined;
           b.isBlocking = false;
         });
         this.notificationService.showToast('Bloqueo ilegal', `Menaza: ${attacker.name} no puede ser bloqueado por una sola criatura.`, 'WARNING');
      }
    });

    // 1.5 Check for un-ordered multi-blocking
    const unOrderedMultiBlockers = attackers.filter(attacker => {
      const blockers = defendingPlayer.field.filter(c => c.blockingTargetId === attacker.id);
      return blockers.length > 1 && !(attacker as any).orderedBlockers;
    });

    if (unOrderedMultiBlockers.length > 0 || (state.pendingBlockerOrders && state.pendingBlockerOrders.length > 0)) {
      if (unOrderedMultiBlockers.length > 0 && !state.pendingBlockerOrders?.length) {
         const pendingOrders = unOrderedMultiBlockers.map(a => ({
           attackerId: a.id,
           blockerIds: defendingPlayer.field.filter(c => c.blockingTargetId === a.id).map(c => c.id)
         }));
         console.log(`⏸️ Pausando combate para elegir orden de bloqueadores...`);
         this.updateState({ pendingBlockerOrders: pendingOrders }, true);
      }
      this.isProcessing = false; 
      return true; 
    }

    // 2. FIRST STRIKE / DOUBLE STRIKE STEP
    attackers.forEach(attacker => {
      const attackerStillAlive = activePlayer.field.find(c => c.id === attacker.id);
      if (!attackerStillAlive) return;

      const blockers = defendingPlayer.field.filter(c => c.blockingTargetId === attacker.id);
      
      const hasFS = this.hasAbility(attacker, 'first strike') || this.hasAbility(attacker, 'dañar primero');
      const hasDS = this.hasAbility(attacker, 'double strike') || this.hasAbility(attacker, 'dañar dos veces');

      const anyBlockerHasFirstOrDoubleStrike = blockers.some(b => 
        this.hasAbility(b, 'first strike') || 
        this.hasAbility(b, 'dañar primero') || 
        this.hasAbility(b, 'double strike') || 
        this.hasAbility(b, 'dañar dos veces')
      );

      if (blockers.length === 0) {
        if (hasFS || hasDS) {
          const dmg = this.getModifiedPower(attacker, activePlayer);
          console.log(`💥 [FIRST_STRIKE] ${attacker.name} NO bloqueado. Daño al objetivo.`);
          this.applyDirectCombatDamage(attacker, dmg, activePlayer, defendingPlayer, state);
        }
      } else {
        if (hasFS || hasDS || anyBlockerHasFirstOrDoubleStrike) {
          console.log(`🛡️ [FIRST_STRIKE] Resolviendo combate en paso de dañar primero.`);
          this.fightSequential(attacker, blockers, activePlayer, defendingPlayer, 'FIRST_STRIKE');
        }
      }
    });

    // 3. NORMAL DAMAGE STEP
    attackers.forEach(attacker => {
      const attackerStillAlive = activePlayer.field.find(c => c.id === attacker.id);
      if (!attackerStillAlive) return;

      const blockers = defendingPlayer.field.filter(c => c.blockingTargetId === attacker.id);
      
      const hasFS = this.hasAbility(attacker, 'first strike') || this.hasAbility(attacker, 'dañar primero');
      const hasDS = this.hasAbility(attacker, 'double strike') || this.hasAbility(attacker, 'dañar dos veces');

      if (blockers.length === 0) {
        if (!hasFS || hasDS) {
          const dmg = this.getModifiedPower(attacker, activePlayer);
          console.log(`💥 [NORMAL] ${attacker.name} NO bloqueado. Daño al objetivo.`);
          this.applyDirectCombatDamage(attacker, dmg, activePlayer, defendingPlayer, state);
        }
      } else {
        const aliveBlockers = blockers.filter(b => defendingPlayer.field.some(c => c.id === b.id));
        if (aliveBlockers.length > 0 || !hasFS || hasDS) {
          console.log(`🛡️ [NORMAL] Resolviendo combate en paso de daño normal.`);
          this.fightSequential(attacker, aliveBlockers, activePlayer, defendingPlayer, 'NORMAL');
        }
      }
    });

    // Cleanup
    attackers.forEach(c => {
      // SPRINT 14: Decayed sacrifice at end of combat
      if (this.hasAbility(c, 'decayed') || this.hasAbility(c, 'descompuesto')) {
        this.moveToGraveyard(c.id, activePlayer.id);
      }
      c.isAttacking = false;
      c.orderedBlockers = undefined;
    });
    defendingPlayer.field.forEach(c => {
      c.blockingTargetId = undefined;
      c.isBlocking = false;
    });

    console.log("🔥 Combate resuelto. Sincronizando daños...");
    
    this.updateState({ 
      player1: { ...state.player1 }, 
      player2: { ...state.player2 },
      pendingBlockerOrders: []
    }, true);
    return false;
  }

  private fight(attacker: GameCard, blocker: GameCard, activePlayer: PlayerGameState, defendingPlayer: PlayerGameState, attackerOnly = false, blockerOnly = false): void {
    let ap = this.getModifiedPower(attacker, activePlayer);
    const at = this.getModifiedToughness(attacker, activePlayer);
    let bp = this.getModifiedPower(blocker, defendingPlayer);
    const bt = this.getModifiedToughness(blocker, defendingPlayer);

    const attackerIndestructible = this.hasAbility(attacker, 'indestructible');
    const blockerIndestructible = this.hasAbility(blocker, 'indestructible');
    const hasDeathtouch = this.hasAbility(attacker, 'deathtouch') || this.hasAbility(attacker, 'toque mortal');
    const blockerDeathtouch = this.hasAbility(blocker, 'deathtouch') || this.hasAbility(blocker, 'toque mortal');

    const attackerHasProtection = this.hasProtectionFrom(attacker, blocker);
    const blockerHasProtection = this.hasProtectionFrom(blocker, attacker);

    if (blockerHasProtection) {
      ap = 0;
      console.log(`🛡️ ${blocker.name} tiene protección contra ${attacker.name}. Daño prevenido.`);
    }
    if (attackerHasProtection) {
      bp = 0;
      console.log(`🛡️ ${attacker.name} tiene protección contra ${blocker.name}. Daño prevenido.`);
    }

    if (!blockerOnly && ap > 0) {
      if (this.hasAbility(attacker, 'lifelink') || this.hasAbility(attacker, 'vínculo vital')) {
        activePlayer.hp += ap;
      }
      
      if (hasDeathtouch) {
        if (!blockerIndestructible) this.moveToGraveyard(blocker.id, defendingPlayer.id);
      } else {
        blocker.damageTaken = (blocker.damageTaken || 0) + ap;
        if (blocker.damageTaken >= bt && !blockerIndestructible) {
          this.moveToGraveyard(blocker.id, defendingPlayer.id);
        }
      }

      if (this.hasAbility(attacker, 'trample') || this.hasAbility(attacker, 'arrollar')) {
        const excess = ap - bt; // Trample excess ignores damageTaken for simplicity unless we want to track remaining toughness
        if (excess > 0) defendingPlayer.hp -= excess;
      }
    }

    if (!attackerOnly && bp > 0) {
      if (this.hasAbility(blocker, 'lifelink') || this.hasAbility(blocker, 'vínculo vital')) {
        defendingPlayer.hp += bp;
      }

      if (blockerDeathtouch) {
        if (!attackerIndestructible) {
          console.log(`💀 ${attacker.name} destruido por toque mortal de ${blocker.name}`);
          this.moveToGraveyard(attacker.id, activePlayer.id);
        }
      } else {
        attacker.damageTaken = (attacker.damageTaken || 0) + bp;
        console.log(`💥 ${attacker.name} recibe ${bp} de daño de ${blocker.name}. Total recibido: ${attacker.damageTaken}/${at}`);
        if (attacker.damageTaken >= at && !attackerIndestructible) {
          console.log(`💀 ${attacker.name} muere por daño letal.`);
          this.moveToGraveyard(attacker.id, activePlayer.id);
        }
      }
    }
  }

  public getModifiedPower(card: GameCard, player: PlayerGameState): number {
    let p = parseInt(card.power || '0');
    
    // Capa 1: Contadores +1/+1
    if (card.counters && card.counters['+1/+1']) {
      p += card.counters['+1/+1'];
    }
    
    // Capa 2: Modificadores temporales ("until end of turn")
    if (card.tempPowerModifier) {
      p += card.tempPowerModifier;
    }
    
    // Capa 3: Efectos estáticos de otras cartas en juego (Lords)
    player.field.forEach(perm => {
      const text = (perm.oracleText || '').toLowerCase();
      
      // Lord genérico: "creatures you control get +1/+1" o similar
      const ptMatch = text.match(/creatures you control get ([+-]\d+)\/([+-]\d+)/);
      if (ptMatch) {
        if (text.includes('other creatures you control') && perm.id === card.id) {
          // No se auto-aplica si dice "other creatures"
        } else {
          p += parseInt(ptMatch[1]);
        }
      }
      
      // Lord específico por Tipo / Color
      const specialLordMatch = text.match(/([\w]+) creatures you control get ([+-]\d+)\/([+-]\d+)/i);
      if (specialLordMatch) {
        const typeOrColor = specialLordMatch[1].toLowerCase().trim();
        const pMod = parseInt(specialLordMatch[2]);
        
        const cType = (card.type || '').toLowerCase();
        const cColors = this.getCardColors(card);
        const matchesType = cType.includes(typeOrColor);
        const matchesColor = cColors.includes(typeOrColor);
        
        if (matchesType || matchesColor) {
          if (text.includes('other') && perm.id === card.id) {
            // No se auto-aplica
          } else {
            p += pMod;
          }
        }
      }
      
      // Lord con habilidad: "creatures you control with {ability} get +X/+Y"
      const abilityLordMatch = text.match(/creatures you control with ([\w\s]+) get ([+-]\d+)\/([+-]\d+)/i);
      if (abilityLordMatch) {
        const reqAbility = abilityLordMatch[1].toLowerCase().trim();
        const pMod = parseInt(abilityLordMatch[2]);
        
        if (this.hasAbility(card, reqAbility)) {
          if (text.includes('other') && perm.id === card.id) {
            // No se auto-aplica
          } else {
            p += pMod;
          }
        }
      }
      
      // Lord con habilidad (español): "las criaturas que controlas con {ability} obtienen +X/+Y"
      const abilityLordMatchEs = text.match(/las criaturas que controlas con ([\w\s]+) obtienen ([+-]\d+)\/([+-]\d+)/i);
      if (abilityLordMatchEs) {
        const reqAbility = abilityLordMatchEs[1].toLowerCase().trim();
        const pMod = parseInt(abilityLordMatchEs[2]);
        
        if (this.hasAbility(card, reqAbility)) {
          if (text.includes('other') && perm.id === card.id) {
            // No se auto-aplica
          } else {
            p += pMod;
          }
        }
      }
      
      // Lord específico por texto
      if (text.includes('other creatures you control get +1/+1') && perm.id !== card.id) {
        p += 1;
      } else if (text.includes('creatures you control get +1/+1')) {
        p += 1;
      }
    });

    // Capa 4: Auras y Equipos anexados
    if (card.attachedCardIds && card.attachedCardIds.length > 0) {
      player.field.forEach(perm => {
        if (card.attachedCardIds?.includes(perm.id)) {
          const text = (perm.oracleText || '').toLowerCase();
          const auraMatch = text.match(/(?:enchanted creature gets|la criatura encantada obtiene|equipped creature gets) ([+-]\d+)\/([+-]\d+)/i);
          if (auraMatch) {
            p += parseInt(auraMatch[1]);
          }
        }
      });
    }

    // Capa 5: Incremento dinámico condicional y de tierras
    const cardText = (card.oracleText || '').toLowerCase();
    const eachLandMatch = cardText.match(/(?:gets|obtiene) \+?(\d+)\/\+?(\d+) for each land you control/i);
    if (eachLandMatch) {
      const landCount = player.field.filter(c => c.type?.toLowerCase().includes('land') || c.type?.toLowerCase().includes('tierra')).length;
      p += parseInt(eachLandMatch[1]) * landCount;
    }

    const condMatches = [...cardText.matchAll(/(?:gets|obtiene) ([+-]\d+)\/([+-]\d+) for each ([\w\s]+)/gi)];
    for (const match of condMatches) {
      const pMod = parseInt(match[1]);
      const condition = match[3].toLowerCase().trim();
      let multiplier = 0;
      
      if (condition.includes('creature in your graveyard') || condition.includes('creature card in your graveyard') || condition.includes('criatura en tu cementerio')) {
        multiplier = player.graveyard.filter(c => (c.type || '').toLowerCase().includes('creature') || (c.type || '').toLowerCase().includes('criatura')).length;
      } else if (condition.includes('artifact you control') || condition.includes('artefacto que controlas')) {
        multiplier = player.field.filter(c => (c.type || '').toLowerCase().includes('artifact') || (c.type || '').toLowerCase().includes('artefacto')).length;
      } else if (condition.includes('enchantment you control') || condition.includes('encantamiento que controlas')) {
        multiplier = player.field.filter(c => (c.type || '').toLowerCase().includes('enchantment') || (c.type || '').toLowerCase().includes('encantamiento')).length;
      } else if (condition.includes('creature you control') || condition.includes('criatura que controlas')) {
        multiplier = player.field.filter(c => (c.type || '').toLowerCase().includes('creature') || (c.type || '').toLowerCase().includes('criatura') || !!c.crewed).length;
      } else if (condition.includes('card in your hand') || condition.includes('carta en tu mano')) {
        multiplier = player.hand.length;
      }
      
      p += pMod * multiplier;
    }

    const condMatchesEs = [...cardText.matchAll(/(?:gets|obtiene) ([+-]\d+)\/([+-]\d+) por cada ([\w\s]+)/gi)];
    for (const match of condMatchesEs) {
      const pMod = parseInt(match[1]);
      const condition = match[3].toLowerCase().trim();
      let multiplier = 0;
      
      if (condition.includes('creature in your graveyard') || condition.includes('creature card in your graveyard') || condition.includes('criatura en tu cementerio')) {
        multiplier = player.graveyard.filter(c => (c.type || '').toLowerCase().includes('creature') || (c.type || '').toLowerCase().includes('criatura')).length;
      } else if (condition.includes('artifact you control') || condition.includes('artefacto que controlas')) {
        multiplier = player.field.filter(c => (c.type || '').toLowerCase().includes('artifact') || (c.type || '').toLowerCase().includes('artefacto')).length;
      } else if (condition.includes('enchantment you control') || condition.includes('encantamiento que controlas')) {
        multiplier = player.field.filter(c => (c.type || '').toLowerCase().includes('enchantment') || (c.type || '').toLowerCase().includes('encantamiento')).length;
      } else if (condition.includes('creature you control') || condition.includes('criatura que controlas')) {
        multiplier = player.field.filter(c => (c.type || '').toLowerCase().includes('creature') || (c.type || '').toLowerCase().includes('criatura') || !!c.crewed).length;
      } else if (condition.includes('card in your hand') || condition.includes('carta en tu mano')) {
        multiplier = player.hand.length;
      }
      
      p += pMod * multiplier;
    }
    
    return Math.max(0, p);
  }

  public getModifiedToughness(card: GameCard, player: PlayerGameState): number {
    let t = parseInt(card.toughness || '0');
    
    // Capa 1: Contadores +1/+1
    if (card.counters && card.counters['+1/+1']) {
      t += card.counters['+1/+1'];
    }
    
    // Capa 2: Modificadores temporales ("until end of turn")
    if (card.tempToughnessModifier) {
      t += card.tempToughnessModifier;
    }
    
    // Capa 3: Efectos estáticos de otras cartas en juego (Lords)
    player.field.forEach(perm => {
      const text = (perm.oracleText || '').toLowerCase();
      
      // Lord genérico: "creatures you control get +1/+1" o similar
      const ptMatch = text.match(/creatures you control get ([+-]\d+)\/([+-]\d+)/);
      if (ptMatch) {
        if (text.includes('other creatures you control') && perm.id === card.id) {
          // No se auto-aplica si dice "other creatures"
        } else {
          t += parseInt(ptMatch[2]);
        }
      }
      
      // Lord específico por Tipo / Color
      const specialLordMatch = text.match(/([\w]+) creatures you control get ([+-]\d+)\/([+-]\d+)/i);
      if (specialLordMatch) {
        const typeOrColor = specialLordMatch[1].toLowerCase().trim();
        const tMod = parseInt(specialLordMatch[3]);
        
        const cType = (card.type || '').toLowerCase();
        const cColors = this.getCardColors(card);
        const matchesType = cType.includes(typeOrColor);
        const matchesColor = cColors.includes(typeOrColor);
        
        if (matchesType || matchesColor) {
          if (text.includes('other') && perm.id === card.id) {
            // No se auto-aplica
          } else {
            t += tMod;
          }
        }
      }
      
      // Lord con habilidad: "creatures you control with {ability} get +X/+Y"
      const abilityLordMatch = text.match(/creatures you control with ([\w\s]+) get ([+-]\d+)\/([+-]\d+)/i);
      if (abilityLordMatch) {
        const reqAbility = abilityLordMatch[1].toLowerCase().trim();
        const tMod = parseInt(abilityLordMatch[3]);
        
        if (this.hasAbility(card, reqAbility)) {
          if (text.includes('other') && perm.id === card.id) {
            // No se auto-aplica
          } else {
            t += tMod;
          }
        }
      }
      
      // Lord con habilidad (español): "las criaturas que controlas con {ability} obtienen +X/+Y"
      const abilityLordMatchEs = text.match(/las criaturas que controlas con ([\w\s]+) obtienen ([+-]\d+)\/([+-]\d+)/i);
      if (abilityLordMatchEs) {
        const reqAbility = abilityLordMatchEs[1].toLowerCase().trim();
        const tMod = parseInt(abilityLordMatchEs[3]);
        
        if (this.hasAbility(card, reqAbility)) {
          if (text.includes('other') && perm.id === card.id) {
            // No se auto-aplica
          } else {
            t += tMod;
          }
        }
      }
      
      // Lord específico por texto
      if (text.includes('other creatures you control get +1/+1') && perm.id !== card.id) {
        t += 1;
      } else if (text.includes('creatures you control get +1/+1')) {
        t += 1;
      }
    });

    // Capa 4: Auras y Equipos anexados
    if (card.attachedCardIds && card.attachedCardIds.length > 0) {
      player.field.forEach(perm => {
        if (card.attachedCardIds?.includes(perm.id)) {
          const text = (perm.oracleText || '').toLowerCase();
          const auraMatch = text.match(/(?:enchanted creature gets|la criatura encantada obtiene|equipped creature gets) ([+-]\d+)\/([+-]\d+)/i);
          if (auraMatch) {
            t += parseInt(auraMatch[2]);
          }
        }
      });
    }

    // Capa 5: Incremento dinámico condicional y de tierras
    const cardText = (card.oracleText || '').toLowerCase();
    const eachLandMatch = cardText.match(/(?:gets|obtiene) \+?(\d+)\/\+?(\d+) for each land you control/i);
    if (eachLandMatch) {
      const landCount = player.field.filter(c => c.type?.toLowerCase().includes('land') || c.type?.toLowerCase().includes('tierra')).length;
      t += parseInt(eachLandMatch[2]) * landCount;
    }

    const condMatches = [...cardText.matchAll(/(?:gets|obtiene) ([+-]\d+)\/([+-]\d+) for each ([\w\s]+)/gi)];
    for (const match of condMatches) {
      const tMod = parseInt(match[2]);
      const condition = match[3].toLowerCase().trim();
      let multiplier = 0;
      
      if (condition.includes('creature in your graveyard') || condition.includes('creature card in your graveyard') || condition.includes('criatura en tu cementerio')) {
        multiplier = player.graveyard.filter(c => (c.type || '').toLowerCase().includes('creature') || (c.type || '').toLowerCase().includes('criatura')).length;
      } else if (condition.includes('artifact you control') || condition.includes('artefacto que controlas')) {
        multiplier = player.field.filter(c => (c.type || '').toLowerCase().includes('artifact') || (c.type || '').toLowerCase().includes('artefacto')).length;
      } else if (condition.includes('enchantment you control') || condition.includes('encantamiento que controlas')) {
        multiplier = player.field.filter(c => (c.type || '').toLowerCase().includes('enchantment') || (c.type || '').toLowerCase().includes('encantamiento')).length;
      } else if (condition.includes('creature you control') || condition.includes('criatura que controlas')) {
        multiplier = player.field.filter(c => (c.type || '').toLowerCase().includes('creature') || (c.type || '').toLowerCase().includes('criatura') || !!c.crewed).length;
      } else if (condition.includes('card in your hand') || condition.includes('carta en tu mano')) {
        multiplier = player.hand.length;
      }
      
      t += tMod * multiplier;
    }

    const condMatchesEs = [...cardText.matchAll(/(?:gets|obtiene) ([+-]\d+)\/([+-]\d+) por cada ([\w\s]+)/gi)];
    for (const match of condMatchesEs) {
      const tMod = parseInt(match[2]);
      const condition = match[3].toLowerCase().trim();
      let multiplier = 0;
      
      if (condition.includes('creature in your graveyard') || condition.includes('creature card in your graveyard') || condition.includes('criatura en tu cementerio')) {
        multiplier = player.graveyard.filter(c => (c.type || '').toLowerCase().includes('creature') || (c.type || '').toLowerCase().includes('criatura')).length;
      } else if (condition.includes('artifact you control') || condition.includes('artefacto que controlas')) {
        multiplier = player.field.filter(c => (c.type || '').toLowerCase().includes('artifact') || (c.type || '').toLowerCase().includes('artefacto')).length;
      } else if (condition.includes('enchantment you control') || condition.includes('encantamiento que controlas')) {
        multiplier = player.field.filter(c => (c.type || '').toLowerCase().includes('enchantment') || (c.type || '').toLowerCase().includes('encantamiento')).length;
      } else if (condition.includes('creature you control') || condition.includes('criatura que controlas')) {
        multiplier = player.field.filter(c => (c.type || '').toLowerCase().includes('creature') || (c.type || '').toLowerCase().includes('criatura') || !!c.crewed).length;
      } else if (condition.includes('card in your hand') || condition.includes('carta en tu mano')) {
        multiplier = player.hand.length;
      }
      
      t += tMod * multiplier;
    }
    
    return Math.max(1, t);
  }

  private returnToHand(cardId: string, playerId: string): void {
    const state = this.gameStateSubject.value;
    if (!state) return;
    const isP1 = state.player1.id === playerId;
    const p = isP1 ? state.player1 : state.player2;
    const index = p.field.findIndex(c => c.id === cardId);
    if (index !== -1) {
      const card = p.field.splice(index, 1)[0];
      p.hand.push(card);
      p.handCount = p.hand.length;
    }
  }

  private detachAttachments(card: GameCard, player: PlayerGameState): void {
    if (card.attachedCardIds && card.attachedCardIds.length > 0) {
      const state = this.gameStateSubject.value;
      if (!state) return;
      const opp = state.player1.id === player.id ? state.player2 : state.player1;

      card.attachedCardIds.forEach(attId => {
        let attCardIdx = player.field.findIndex(c => c.id === attId);
        let currentOwner = player;
        
        if (attCardIdx === -1) {
          attCardIdx = opp.field.findIndex(c => c.id === attId);
          currentOwner = opp;
        }

        if (attCardIdx !== -1) {
          const attCard = currentOwner.field[attCardIdx];
          const type = (attCard.type || '').toLowerCase();
          
          if (type.includes('aura') || type.includes('encantamiento - aura')) {
            currentOwner.field.splice(attCardIdx, 1);
            attCard.attachedToCardId = undefined;
            if (!attCard.isToken) {
              currentOwner.graveyard.push(attCard);
              currentOwner.graveyardCount = currentOwner.graveyard.length;
            }
            console.log(`🪦 Aura ${attCard.name} destruida al dejar el campo su anfitrión.`);
          } else {
            attCard.attachedToCardId = undefined;
            console.log(`🛡️ Equipment ${attCard.name} se desanexa y cae al campo de batalla.`);
          }
        }
      });
      card.attachedCardIds = [];
    }
  }

  private moveToGraveyard(cardId: string, playerId: string): void {
    const state = this.gameStateSubject.value;
    if (!state) return;
    const isP1 = state.player1.id === playerId;
    const p = isP1 ? state.player1 : state.player2;
    const index = p.field.findIndex(c => c.id === cardId);
    if (index !== -1) {
      const card = p.field.splice(index, 1)[0];
      card.isAttacking = false;
      card.isBlocking = false;
      card.blockingTargetId = undefined;
      card.damageTaken = 0; // Reset damage in graveyard
      
      this.detachAttachments(card, p);
      
      if (card.isToken) {
        console.log(`✨ Ficha (Token) ${card.name} deja de existir al salir del campo.`);
      } else if (card.disturbExileOnLeave) {
        console.log(`🌀 Carta perturbada ${card.name} se exilia en lugar de ir al cementerio.`);
        card.disturbExileOnLeave = false; // Reset flag
        card.currentFaceIndex = 0; // Reset to front face
        p.exile = p.exile || [];
        p.exile.push(card);
        p.exileCount = p.exile.length;
        this.notificationService.showToast('Exilio por Perturbar', `"${card.name}" se ha exiliado al dejar el campo de batalla.`, 'INFO');
      } else {
        p.graveyard.push(card);
        p.graveyardCount = p.graveyard.length;
      }
      p.field = [...p.field]; // Force new reference
      console.log(`🪦 Carta ${card.name} movida al cementerio de ${p.username}.`);
    } else {
      console.warn(`⚠️ No se pudo encontrar la carta ${cardId} en el campo de ${p.username} para moverla al cementerio.`);
    }
  }

  public exileCard(cardId: string, playerId: string): void {
    const state = this.gameStateSubject.value;
    if (!state) return;
    const isP1 = state.player1.id === playerId;
    const p = isP1 ? state.player1 : state.player2;

    let card: GameCard | undefined;

    // 1. Buscar en el campo de batalla
    const fieldIdx = p.field.findIndex(c => c.id === cardId);
    if (fieldIdx !== -1) {
      card = p.field.splice(fieldIdx, 1)[0];
      card.isAttacking = false;
      card.isBlocking = false;
      card.blockingTargetId = undefined;
      p.field = [...p.field];
      this.detachAttachments(card, p);
    }

    // 2. Buscar en la mano
    if (!card) {
      const handIdx = p.hand.findIndex(c => c.id === cardId);
      if (handIdx !== -1) {
        card = p.hand.splice(handIdx, 1)[0];
        p.hand = [...p.hand];
        p.handCount = p.hand.length;
      }
    }

    // 3. Buscar en el cementerio
    if (!card) {
      const graveIdx = p.graveyard.findIndex(c => c.id === cardId);
      if (graveIdx !== -1) {
        card = p.graveyard.splice(graveIdx, 1)[0];
        p.graveyard = [...p.graveyard];
        p.graveyardCount = p.graveyard.length;
      }
    }

    // 4. Buscar en la biblioteca
    if (!card) {
      const libIdx = p.library.findIndex(c => c.id === cardId);
      if (libIdx !== -1) {
        card = p.library.splice(libIdx, 1)[0];
        p.library = [...p.library];
        p.libraryCount = p.library.length;
      }
    }

    if (card) {
      card.damageTaken = 0; // Resetear daño
      card.isTapped = false; // Resetear tapeo
      
      if (card.isToken) {
        console.log(`✨ Ficha (Token) ${card.name} deja de existir al ser exiliada.`);
        this.notificationService.showToast('Exilio', `Ficha "${card.name}" deja de existir.`, 'INFO');
      } else {
        p.exile = p.exile || [];
        p.exile.push(card);
        p.exileCount = p.exile.length;
        
        console.log(`🌀 Carta ${card.name} exiliada del jugador ${p.username}.`);
        this.notificationService.showToast('Exilio', `${card.name} ha sido exiliada.`, 'INFO');
      }
      
      this.updateState({});
    } else {
      console.warn(`⚠️ No se encontró la carta ${cardId} en ninguna zona para exiliarla.`);
    }
  }

  confirmBlockerOrder(attackerId: string, orderedBlockerIds: string[]): void {
    const state = this.gameStateSubject.value;
    if (!state || !state.pendingBlockerOrders) return;

    // Only allow active player to set orders
    if (state.activePlayerId !== this.me()?.id) return;

    const activePlayer = state.player1.id === state.activePlayerId ? state.player1 : state.player2;
    const attacker = activePlayer.field.find(c => c.id === attackerId);
    if (attacker) {
      (attacker as any).orderedBlockers = orderedBlockerIds;
    }

    state.pendingBlockerOrders = state.pendingBlockerOrders.filter(o => o.attackerId !== attackerId);
    if (state.pendingBlockerOrders.length === 0) {
      state.pendingBlockerOrders = undefined;
      // All ordered, resume combat resolution!
      this.resolveCombat();
      
      // Check if we need to advance phase if resolveCombat finished and didn't pause again
      if (!this.gameStateSubject.value?.pendingBlockerOrders) {
         this.nextPhase();
      }
    } else {
      this.gameStateSubject.next({ ...state });
      this.updateState({}, true);
    }
  }

  private fightSequential(
    attacker: GameCard, 
    blockers: GameCard[], 
    activePlayer: PlayerGameState, 
    defendingPlayer: PlayerGameState,
    step: 'FIRST_STRIKE' | 'NORMAL'
  ): void {
    const hasFS = this.hasAbility(attacker, 'first strike') || this.hasAbility(attacker, 'dañar primero');
    const hasDS = this.hasAbility(attacker, 'double strike') || this.hasAbility(attacker, 'dañar dos veces');
    const hasTrample = this.hasAbility(attacker, 'trample') || this.hasAbility(attacker, 'arrollar');

    const attackerDeals = (step === 'FIRST_STRIKE' && (hasFS || hasDS)) || (step === 'NORMAL' && (!hasFS || hasDS));
    let remainingAttackerDamage = attackerDeals ? this.getModifiedPower(attacker, activePlayer) : 0;
    const order = (attacker as any).orderedBlockers || blockers.map(b => b.id);
    
    // Sort blockers based on the defined order
    const sortedBlockers = [...blockers].sort((a, b) => {
      const idxA = order.indexOf(a.id);
      const idxB = order.indexOf(b.id);
      return (idxA === -1 ? 999 : idxA) - (idxB === -1 ? 999 : idxB);
    });

    sortedBlockers.forEach(blocker => {
      const blockerStillAlive = defendingPlayer.field.find(c => c.id === blocker.id);
      if (!blockerStillAlive) return; // Blocker might have died from another attacker's first strike damage!

      const blockerFS = this.hasAbility(blocker, 'first strike') || this.hasAbility(blocker, 'dañar primero');
      const blockerDS = this.hasAbility(blocker, 'double strike') || this.hasAbility(blocker, 'dañar dos veces');
      const blockerDeals = (step === 'FIRST_STRIKE' && (blockerFS || blockerDS)) || (step === 'NORMAL' && (!blockerFS || blockerDS));

      let blockerPower = blockerDeals ? this.getModifiedPower(blocker, defendingPlayer) : 0;
      const blockerToughness = this.getModifiedToughness(blocker, defendingPlayer);
      const remainingBlockerToughness = Math.max(0, blockerToughness - (blocker.damageTaken || 0));

      const attackerHasProtection = this.hasProtectionFrom(attacker, blocker);
      const blockerHasProtection = this.hasProtectionFrom(blocker, attacker);

      if (attackerHasProtection) {
        blockerPower = 0;
        console.log(`🛡️ ${attacker.name} tiene protección contra ${blocker.name}. Daño prevenido.`);
      }

      // Attacker deals damage to blocker
      if (remainingAttackerDamage > 0) {
        const damageToAssign = blockerHasProtection ? 0 : Math.min(remainingAttackerDamage, remainingBlockerToughness);
        const isLast = blocker === sortedBlockers[sortedBlockers.length - 1];
        const finalDamage = (isLast && !hasTrample && !blockerHasProtection) ? remainingAttackerDamage : damageToAssign;

        if (blockerHasProtection) {
          console.log(`🛡️ ${blocker.name} tiene protección contra ${attacker.name}. Daño prevenido.`);
        } else {
          blocker.damageTaken = (blocker.damageTaken || 0) + finalDamage;
          remainingAttackerDamage -= finalDamage;
          console.log(`💥 [${step}] ${attacker.name} hace ${finalDamage} de daño a ${blocker.name}. (Restante: ${remainingAttackerDamage})`);
          
          if (blocker.damageTaken >= blockerToughness) {
            console.log(`💀 ${blocker.name} muere por daño de ${attacker.name}`);
            this.moveToGraveyard(blocker.id, defendingPlayer.id);
          }
        }
      }

      // Blocker deals damage back to attacker (simultaneous)
      if (blockerPower > 0) {
        const attackerToughness = this.getModifiedToughness(attacker, activePlayer);
        attacker.damageTaken = (attacker.damageTaken || 0) + blockerPower;
        console.log(`💥 [${step}] ${blocker.name} hace ${blockerPower} de daño a ${attacker.name}. Total: ${attacker.damageTaken}/${attackerToughness}`);
        
        if (attacker.damageTaken >= attackerToughness) {
          console.log(`💀 ${attacker.name} muere por daño de los bloqueadores.`);
          this.moveToGraveyard(attacker.id, activePlayer.id);
        }
      }
    });

    // Trample remaining damage to the player
    if (hasTrample && remainingAttackerDamage > 0) {
      defendingPlayer.hp -= remainingAttackerDamage;
      console.log(`🐘 [${step}] Trample (Arrollar): Daño arrollado al jugador: ${remainingAttackerDamage}`);
      this.notificationService.showToast('Arrollar (Trample)', `"${attacker.name}" arrolló ${remainingAttackerDamage} daño al rival.`, 'SUCCESS');
      remainingAttackerDamage = 0;
    }
  }

  public transformCard(cardId: string, player: PlayerGameState): void {
    const card = player.field.find(c => c.id === cardId);
    if (!card || !card.isDoubleFaced) return;

    const newFaceIndex = card.currentFaceIndex === 1 ? 0 : 1;
    card.currentFaceIndex = newFaceIndex;

    // Swap properties
    if (card.faces && card.faces.length > 1) {
      const face = card.faces[newFaceIndex];
      card.name = face.name;
      card.type = face.type;
      card.oracleText = face.oracleText;
      
      // Swap images
      const oldImg = card.imageUrl;
      card.imageUrl = face.imageUrl || card.imageUrl2 || oldImg;
      card.imageUrl2 = oldImg;

      if (face.powerToughness) {
        const parts = face.powerToughness.split('/');
        if (parts.length === 2) {
          card.power = parts[0].trim();
          card.toughness = parts[1].trim();
        }
      }
    } else {
      // Simple flip without card.faces (backup)
      if (card.imageUrl2) {
        const oldImg = card.imageUrl;
        card.imageUrl = card.imageUrl2;
        card.imageUrl2 = oldImg;
      }
    }

    console.log(`🔄 Carta transformada a Cara ${newFaceIndex}: ${card.name} (${card.power}/${card.toughness})`);
    this.notificationService.showToast('Transformación', `"${card.name}" se ha transformado!`, 'SUCCESS');
  }

  public resolveScrySurveil(
    playerId: string,
    topCardIds: string[],
    bottomCardIds: string[],
    graveyardCardIds: string[]
  ): void {
    const state = this.gameStateSubject.value;
    if (!state || !state.pendingScrySurveilChoice) return;

    const nextState = JSON.parse(JSON.stringify(state));
    const player = nextState.player1.id === playerId ? nextState.player1 : nextState.player2;
    const choice = nextState.pendingScrySurveilChoice;

    const originalCards = choice.cards;

    // Reconstruir los arreglos según las decisiones tomadas en la UI
    const topCards = topCardIds.map(id => originalCards.find((c: any) => c.id === id)).filter((c): c is GameCard => !!c);
    const bottomCards = bottomCardIds.map(id => originalCards.find((c: any) => c.id === id)).filter((c): c is GameCard => !!c);
    const graveyardCards = graveyardCardIds.map(id => originalCards.find((c: any) => c.id === id)).filter((c): c is GameCard => !!c);

    // Devolver las cartas a su sitio correspondiente
    player.library.unshift(...topCards);
    player.library.push(...bottomCards);
    player.graveyard.push(...graveyardCards);

    player.libraryCount = player.library.length;
    player.graveyardCount = player.graveyard.length;

    // Limpiar el estado de elección pendiente
    delete nextState.pendingScrySurveilChoice;

    this.gameStateSubject.next(nextState);
    this.updateState({}, true);

    console.log(`✅ Elección de SCRY/SURVEIL resuelta para ${player.username}: ${topCards.length} arriba, ${bottomCards.length} abajo, ${graveyardCards.length} cementerio.`);
    this.notificationService.showToast(
      choice.type === 'SCRY' ? 'Adivinar completado' : 'Vigilar completado',
      `Se han reorganizado las cartas de tu biblioteca.`,
      'SUCCESS'
    );
  }

  public crewVehicle(vehicleId: string, creatureIds: string[]): void {
    const state = this.gameStateSubject.value;
    if (!state || !state.pendingCrewChoice) return;

    const nextState = JSON.parse(JSON.stringify(state));
    const player = nextState.activePlayerId === nextState.player1.id ? nextState.player1 : nextState.player2;

    const vehicle = player.field.find((c: any) => c.id === vehicleId);
    if (!vehicle) return;

    // Girar a las criaturas elegidas para tripular
    creatureIds.forEach(id => {
      const creature = player.field.find((c: any) => c.id === id);
      if (creature) {
        creature.isTapped = true;
      }
    });

    // Tripular el vehículo
    vehicle.crewed = true;

    // Limpiar estado pendiente
    delete nextState.pendingCrewChoice;

    this.gameStateSubject.next(nextState);
    this.updateState({}, true);

    this.notificationService.showToast('Vehículo Tripulado', `"${vehicle.name}" se ha convertido en criatura hasta el final del turno!`, 'SUCCESS');
  }

  public cancelCrewChoice(): void {
    const state = this.gameStateSubject.value;
    if (!state) return;
    const nextState = { ...state };
    delete nextState.pendingCrewChoice;
    this.gameStateSubject.next(nextState);
  }

  private parseCrewValue(card: GameCard): number {
    const text = (card.oracleText || '').toLowerCase();
    const crewMatch = text.match(/(?:crew|tripular)\s+(\d+)/i);
    return crewMatch ? parseInt(crewMatch[1]) : 1;
  }

  // --- HELPER METHODS FOR SPRINT 7 ---
  public resolveSacrifice(cardId: string): void {
    const state = this.gameStateSubject.value;
    if (!state || !state.pendingSacrificeChoice) return;

    const choice = state.pendingSacrificeChoice;
    const player = state.player1.id === choice.playerId ? state.player1 : state.player2;
    
    const cardIndex = player.field.findIndex(c => c.id === cardId);
    if (cardIndex !== -1) {
      const card = player.field[cardIndex];
      player.field.splice(cardIndex, 1);
      player.graveyard.push(card);
      player.graveyardCount = player.graveyard.length;

      this.notificationService.showToast('Sacrificio', `Has sacrificado "${card.name}".`, 'SUCCESS');

      const sourceId = choice.sourceCardId;
      state.pendingSacrificeChoice = undefined;

      if (sourceId) {
        this.additionalCostPaidMap.set(sourceId, true);
        this.gameStateSubject.next({ ...state });
        this.isProcessing = false;
        this.playCard(sourceId);
      } else {
        this.updateState({}, true);
      }
    }
  }

  public resolveGraveyardSelection(cardId: string): void {
    const state = this.gameStateSubject.value;
    if (!state || !state.pendingGraveyardSelection) return;

    const sel = state.pendingGraveyardSelection;
    const player = state.player1.id === sel.playerId ? state.player1 : state.player2;

    const cardIndex = player.graveyard.findIndex(c => c.id === cardId);
    if (cardIndex !== -1) {
      const card = player.graveyard[cardIndex];
      player.graveyard.splice(cardIndex, 1);
      player.graveyardCount = player.graveyard.length;

      if (sel.effectType === 'EXILE') {
        player.exile = player.exile || [];
        player.exile.push(card);
        player.exileCount = player.exile.length;
        this.notificationService.showToast('Carta exiliada', `"${card.name}" ha sido exiliada del cementerio.`, 'SUCCESS');
      } else if (sel.effectType === 'RETURN_TO_HAND') {
        player.hand.push(card);
        player.handCount = player.hand.length;
        this.notificationService.showToast('Regresada a la mano', `"${card.name}" ha regresado a tu mano.`, 'SUCCESS');
      }

      state.pendingGraveyardSelection = undefined;
      this.updateState({}, true);
    }
  }

  public checkAutomatedSacrifice(): void {
    const state = this.gameStateSubject.value;
    if (!state || !state.pendingSacrificeChoice) return;
    
    const choice = state.pendingSacrificeChoice;
    const player = state.player1.id === choice.playerId ? state.player1 : state.player2;
    
    if (player.id === state.player2.id) { // Bot
      const validCards = player.field.filter(c => {
        if (choice.validTypes === 'CREATURE') {
          return !c.type?.toLowerCase().includes('land');
        }
        return true;
      });

      if (validCards.length > 0) {
        const worst = validCards.reduce((prev, curr) => {
          const prevPow = parseInt(prev.power || '0');
          const currPow = parseInt(curr.power || '0');
          return prevPow < currPow ? prev : curr;
        });
        setTimeout(() => {
          this.resolveSacrifice(worst.id);
        }, 500);
      } else {
        state.pendingSacrificeChoice = undefined;
        this.gameStateSubject.next({ ...state });
      }
    }
  }

  public checkAutomatedGraveyardSelection(): void {
    const state = this.gameStateSubject.value;
    if (!state || !state.pendingGraveyardSelection) return;

    const sel = state.pendingGraveyardSelection;
    const player = state.player1.id === sel.playerId ? state.player1 : state.player2;

    if (player.id === state.player2.id) { // Bot
      const card = player.graveyard[0];
      if (card) {
        setTimeout(() => {
          this.resolveGraveyardSelection(card.id);
        }, 500);
      } else {
        state.pendingGraveyardSelection = undefined;
        this.gameStateSubject.next({ ...state });
      }
    }
  }

  // --- SPRINT 10: SAGAS, PLANESWALKERS Y BATALLAS ---

  private triggerSagaChapter(saga: GameCard, chapter: number, player: PlayerGameState, state: GameState): void {
    const text = saga.oracleText || '';
    const lines = text.split('\n');
    
    const numerals = ['0', 'I', 'II', 'III', 'IV', 'V'];
    const currentNumeral = numerals[chapter] || '';
    
    let chapterEffectText = '';
    for (const line of lines) {
      const cleanLine = line.replace(/\[|\]/g, '').trim();
      const match = cleanLine.match(/^([I,V\s]+)\s*[-—]\s*(.*)/i);
      if (match) {
        const chaptersString = match[1].toUpperCase();
        const effectPart = match[2];
        
        const chaptersList = chaptersString.split(',').map(c => c.trim());
        if (chaptersList.includes(currentNumeral)) {
          chapterEffectText = effectPart;
          break;
        }
      }
    }
    
    if (chapterEffectText) {
      console.log(`📜 Saga chapter ${currentNumeral} triggered: "${chapterEffectText}"`);
      this.notificationService.showToast(
        saga.name,
        `Capítulo ${currentNumeral}: ${chapterEffectText.substring(0, 60)}...`,
        'INFO'
      );
      
      const effect = this.parseCardEffect(saga, chapterEffectText);
      if (effect) {
        const stackItem: StackItem = {
          id: 'trigger_' + Math.random().toString(36).substr(2, 9),
          sourceCardId: saga.id,
          controllerId: player.id,
          type: 'TRIGGER',
          name: `${saga.name} — Capítulo ${currentNumeral}`,
          effect: effect
        };
        state.stack.push(stackItem);
      }
    }
  }

  private getSagaMaxChapters(saga: GameCard): number {
    const text = saga.oracleText || '';
    const matches = text.match(/^(V|IV|III|II|I)\b/gim);
    if (!matches) return 3;
    const numerals = ['I', 'II', 'III', 'IV', 'V'];
    let max = 1;
    matches.forEach(m => {
      const idx = numerals.indexOf(m.toUpperCase());
      if (idx !== -1 && (idx + 1) > max) {
        max = idx + 1;
      }
    });
    return max;
  }

  private checkSagaSacrifices(state: GameState): void {
    [state.player1, state.player2].forEach(player => {
      const toSacrifice: string[] = [];
      player.field.forEach(card => {
        if (card.isSaga && card.counters && card.counters['lore']) {
          const max = this.getSagaMaxChapters(card);
          if (card.counters['lore'] >= max) {
            toSacrifice.push(card.id);
          }
        }
      });
      
      toSacrifice.forEach(id => {
        const idx = player.field.findIndex(c => c.id === id);
        if (idx !== -1) {
          const card = player.field[idx];
          player.field.splice(idx, 1);
          player.graveyard.push(card);
          player.graveyardCount = player.graveyard.length;
          this.notificationService.showToast('Saga completada', `"${card.name}" ha sido sacrificada tras completar su historia.`, 'SUCCESS');
        }
      });
    });
  }

  private getPlaneswalkerStartingLoyalty(card: GameCard): number {
    if (card.toughness && !isNaN(parseInt(card.toughness))) {
      return parseInt(card.toughness);
    }
    const text = card.oracleText || '';
    const match = text.match(/loyalty\s+(\d+)/i);
    if (match) return parseInt(match[1]);
    return 3;
  }

  public getPlaneswalkerAbilities(card: GameCard): { cost: number; text: string; effect: any }[] {
    const text = card.oracleText || '';
    const lines = text.split('\n');
    const abilities: { cost: number; text: string; effect: any }[] = [];
    
    lines.forEach(line => {
      const cleanLine = line.replace(/\[|\]/g, '').trim();
      const match = cleanLine.match(/^([+-]?\d+)\s*:\s*(.*)/i);
      if (match) {
        const cost = parseInt(match[1]);
        const effectText = match[2];
        abilities.push({
          cost: cost,
          text: cleanLine,
          effect: this.parseCardEffect(card, effectText)
        });
      }
    });
    return abilities;
  }

  public getPlaneswalkerAbilitiesString(card: GameCard): string[] {
    return this.getPlaneswalkerAbilities(card).map(a => a.text);
  }

  public activatePlaneswalkerAbility(planeswalkerId: string, abilityIndex: number): void {
    const state = this.gameStateSubject.value;
    if (!state || this.isProcessing) return;
    this.isProcessing = true;
    
    const player = state.player1.id === state.activePlayerId ? state.player1 : state.player2;
    const pw = player.field.find(c => c.id === planeswalkerId);
    if (!pw || !pw.isPlaneswalker || pw.loyaltyUsedThisTurn) {
      this.isProcessing = false;
      return;
    }
    
    const abilities = this.getPlaneswalkerAbilities(pw);
    const ability = abilities[abilityIndex];
    if (!ability) {
      this.isProcessing = false;
      return;
    }
    
    const currentLoyalty = pw.counters?.['loyalty'] || 0;
    if (ability.cost < 0 && currentLoyalty < Math.abs(ability.cost)) {
      this.notificationService.showToast('Insuficiente Lealtad', 'No tienes suficiente lealtad para activar esta habilidad.', 'WARNING');
      this.isProcessing = false;
      return;
    }
    
    pw.counters = pw.counters || {};
    pw.counters['loyalty'] = currentLoyalty + ability.cost;
    pw.loyaltyUsedThisTurn = true;
    
    this.notificationService.showToast('Habilidad activada', `Lealtad cambiada por ${ability.cost > 0 ? '+' + ability.cost : ability.cost}`, 'SUCCESS');
    
    if (pw.counters['loyalty'] <= 0) {
      const idx = player.field.findIndex(c => c.id === planeswalkerId);
      if (idx !== -1) {
        player.field.splice(idx, 1);
        player.graveyard.push(pw);
        player.graveyardCount = player.graveyard.length;
        this.notificationService.showToast('Planeswalker derrotado', `${pw.name} se ha quedado sin lealtad y ha muerto.`, 'INFO');
      }
    }
    
    if (ability.effect) {
      const stackItem: StackItem = {
        id: 'pw_' + Math.random().toString(36).substr(2, 9),
        sourceCardId: pw.id,
        controllerId: player.id,
        type: 'ABILITY',
        name: `${pw.name} (${ability.cost >= 0 ? '+' : ''}${ability.cost})`,
        effect: ability.effect
      };
      
      if (ability.effect.needsTarget) {
        state.pendingTarget = {
          sourceCardId: pw.id,
          validTargets: ability.effect.validTargets,
          effect: ability.effect.effect,
          value: ability.effect.value
        };
        state.stack.push(stackItem);
      } else {
        state.stack.push(stackItem);
      }
    }
    
    this.updateState(state, true, () => {
      this.isProcessing = false;
    });
  }

  private getBattleStartingDefense(card: GameCard): number {
    if (card.toughness && !isNaN(parseInt(card.toughness))) {
      return parseInt(card.toughness);
    }
    const text = card.oracleText || '';
    const match = text.match(/defense\s+(\d+)/i);
    if (match) return parseInt(match[1]);
    return 4;
  }

  private defeatBattle(battle: GameCard, player: PlayerGameState, state: GameState): void {
    const controller = state.player1.field.some(c => c.id === battle.id) ? state.player1 : state.player2;
    const idx = controller.field.findIndex(c => c.id === battle.id);
    if (idx !== -1) {
      controller.field.splice(idx, 1);
    }
    controller.exile = controller.exile || [];
    controller.exile.push(battle);
    controller.exileCount = controller.exile.length;
    
    this.notificationService.showToast('¡Batalla Derrotada!', `"${battle.name}" ha sido derrotada y se exilia para transformarse!`, 'SUCCESS');
    
    const transformedCard = JSON.parse(JSON.stringify(battle));
    transformedCard.isBattle = false;
    transformedCard.counters = {};
    if (transformedCard.faces && transformedCard.faces.length > 1) {
      const backFace = transformedCard.faces[1];
      transformedCard.name = backFace.name;
      transformedCard.type = backFace.type;
      transformedCard.oracleText = backFace.oracleText;
      transformedCard.imageUrl = backFace.imageUrl;
      if (backFace.powerToughness) {
        const pt = backFace.powerToughness.split('/');
        transformedCard.power = pt[0].trim();
        transformedCard.toughness = pt[1].trim();
      }
    } else {
      transformedCard.name = `${battle.name} Transformed`;
      transformedCard.type = 'Creature';
      transformedCard.power = '4';
      transformedCard.toughness = '4';
    }
    
    const stackItem: StackItem = {
      id: 'cast_' + Math.random().toString(36).substr(2, 9),
      sourceCardId: transformedCard.id,
      controllerId: player.id,
      type: 'SPELL',
      name: `${transformedCard.name} (Hechizo de Batalla)`,
      card: transformedCard
    };
    state.stack.push(stackItem);
  }

  private applyDirectCombatDamage(attacker: GameCard, damage: number, activePlayer: PlayerGameState, defendingPlayer: PlayerGameState, state: GameState): void {
    if (damage <= 0) return;
    
    const targetCard = defendingPlayer.field.find(c => c.id === attacker.attackingTargetId)
      || activePlayer.field.find(c => c.id === attacker.attackingTargetId);
      
    if (targetCard) {
      if (targetCard.isPlaneswalker) {
        targetCard.counters = targetCard.counters || {};
        const loyalty = targetCard.counters['loyalty'] || 0;
        const newLoyalty = Math.max(0, loyalty - damage);
        targetCard.counters['loyalty'] = newLoyalty;
        
        console.log(`💥 ${attacker.name} inflige ${damage} de daño a Planeswalker ${targetCard.name}. Nueva lealtad: ${newLoyalty}`);
        this.notificationService.showToast('Daño a Planeswalker', `"${attacker.name}" inflige ${damage} de daño a "${targetCard.name}".`, 'INFO');
        
        if (newLoyalty <= 0) {
          const idx = defendingPlayer.field.findIndex(c => c.id === targetCard.id);
          if (idx !== -1) {
            defendingPlayer.field.splice(idx, 1);
            defendingPlayer.graveyard.push(targetCard);
            defendingPlayer.graveyardCount = defendingPlayer.graveyard.length;
            this.notificationService.showToast('Planeswalker derrotado', `"${targetCard.name}" ha sido derrotado.`, 'SUCCESS');
          }
        }
      } else if (targetCard.isBattle) {
        targetCard.counters = targetCard.counters || {};
        const defense = targetCard.counters['defense'] || 0;
        const newDefense = Math.max(0, defense - damage);
        targetCard.counters['defense'] = newDefense;
        
        console.log(`💥 ${attacker.name} inflige ${damage} de daño a Batalla ${targetCard.name}. Nueva defensa: ${newDefense}`);
        this.notificationService.showToast('Daño a Batalla', `"${attacker.name}" inflige ${damage} de daño a "${targetCard.name}".`, 'INFO');
        
        if (newDefense <= 0) {
          this.defeatBattle(targetCard, activePlayer, state);
        }
      }
    } else {
      const text = (attacker.oracleText || '').toLowerCase();
      const hasInfect = text.includes('infect') || text.includes('infectar');
      const hasToxic = text.includes('toxic') || text.includes('tóxico');
      
      let poisonToAdd = 0;
      let hpToLose = damage;

      if (hasInfect) {
        hpToLose = 0;
        poisonToAdd = damage;
      } else if (hasToxic) {
        const match = text.match(/(?:toxic|tóxico)\s*(\d+)/i);
        if (match) {
          poisonToAdd = parseInt(match[1], 10);
        }
      }

      if (hpToLose > 0) {
        console.log(`💥 ${attacker.name} inflige ${hpToLose} de daño directo al oponente ${defendingPlayer.username}.`);
        defendingPlayer.hp -= hpToLose;
      }

      if (poisonToAdd > 0) {
        defendingPlayer.poisonCounters = (defendingPlayer.poisonCounters || 0) + poisonToAdd;
        console.log(`☣️ ${attacker.name} inflige ${poisonToAdd} contadores de veneno al oponente ${defendingPlayer.username}. (Total: ${defendingPlayer.poisonCounters})`);
        this.notificationService.showToast('¡Daño Venenoso!', `"${attacker.name}" causa ${poisonToAdd} contador(es) de veneno a "${defendingPlayer.username}".`, 'WARNING');
      }
    }
  }

  private processSagasTurnStart(state: GameState, playerId: string): GameState {
    const isP1 = state.player1.id === playerId;
    const player = isP1 ? state.player1 : state.player2;
    
    player.field.forEach(card => {
      if (card.type?.toLowerCase().includes('saga')) {
        card.isSaga = true;
        card.counters = card.counters || {};
        card.counters['lore'] = (card.counters['lore'] || 0) + 1;
        this.triggerSagaChapter(card, card.counters['lore'], player, state);
      }
    });
    return state;
  }

  // --- SPRINT 11: MECÁNICAS DE STANDARD (LANDFALL, AVENTURA Y DÍA/NOCHE) ---

  private checkLandfallTriggers(player: PlayerGameState, state: GameState): void {
    player.field.forEach(card => {
      const text = (card.oracleText || '').toLowerCase();
      const hasLandfall = text.includes('landfall —') || text.includes('landfall -') || text.includes('whenever a land enters');
      if (hasLandfall) {
        console.log(`🌱 Landfall disparado en ${card.name}`);
        let effectToTrigger: any = null;
        if (text.includes('gain') && (text.includes('life') || text.includes('vida'))) {
          effectToTrigger = {
            effect: 'GAIN_LIFE',
            value: text.includes('3') ? 3 : (text.includes('4') ? 4 : 2),
            needsTarget: false
          };
        } else if (text.includes('counter') && (text.includes('+1/+1') || text.includes('un contador'))) {
          effectToTrigger = {
            effect: 'ADD_COUNTER',
            value: 1,
            needsTarget: text.includes('target')
          };
        } else if (text.includes('draw') && (text.includes('card') || text.includes('carta'))) {
          effectToTrigger = {
            effect: 'DRAW_CARD',
            value: 1,
            needsTarget: false
          };
        } else {
          effectToTrigger = {
            effect: 'BOOST_STATS',
            value: 2, // +2/+2 hasta el final del turno
            needsTarget: false
          };
        }

        const triggerItem: StackItem = {
          id: Math.random().toString(),
          sourceCardId: card.id,
          controllerId: player.id,
          type: 'TRIGGER',
          name: `Landfall (${card.name})`,
          effect: effectToTrigger
        };
        state.stack.push(triggerItem);
        this.notificationService.showToast('Aterrizaje (Landfall)', `Se ha disparado la habilidad de Aterrizaje de "${card.name}".`, 'SUCCESS');
      }
    });
  }

  private processDayNightCycle(state: GameState, previousPlayerId: string): void {
    if (!state.timeCycle || state.timeCycle === 'NONE') return;

    const spellsCast = state.spellsCastThisTurn ? (state.spellsCastThisTurn[previousPlayerId] || 0) : 0;
    
    if (state.timeCycle === 'DAY') {
      if (spellsCast === 0) {
        state.timeCycle = 'NIGHT';
        this.notificationService.showToast('Ciclo Día/Noche', '¡Se ha hecho de NOCHE! Las criaturas diurnas/nocturnas se transforman.', 'INFO');
        this.transformAllDayNightCards(state, 1);
      }
    } else if (state.timeCycle === 'NIGHT') {
      if (spellsCast >= 2) {
        state.timeCycle = 'DAY';
        this.notificationService.showToast('Ciclo Día/Noche', '¡Se ha hecho de DÍA! Las criaturas diurnas/nocturnas se transforman.', 'SUCCESS');
        this.transformAllDayNightCards(state, 0);
      }
    }

    state.spellsCastThisTurn = {};
  }

  private transformAllDayNightCards(state: GameState, faceIndex: number): void {
    const transformPlayerField = (player: PlayerGameState) => {
      player.field.forEach(card => {
        if (card.isDoubleFaced && card.faces) {
          const isDayNightCard = card.faces.some(f => {
            const text = (f.oracleText || '').toLowerCase();
            return text.includes('daybound') || text.includes('nightbound') || text.includes('diurno') || text.includes('nocturno');
          });
          if (isDayNightCard) {
            this.transformCardFace(card, faceIndex);
          }
        }
      });
    };
    transformPlayerField(state.player1);
    transformPlayerField(state.player2);
  }

  private transformCardFace(card: GameCard, faceIndex: number): void {
    if (!card.isDoubleFaced || !card.faces || card.faces.length <= faceIndex) return;
    
    card.currentFaceIndex = faceIndex;
    const face = card.faces[faceIndex];
    card.name = face.name;
    card.imageUrl = face.imageUrl;
    card.type = face.type;
    card.oracleText = face.oracleText;
    
    if (face.powerToughness) {
      const parts = face.powerToughness.split('/');
      card.power = parts[0]?.trim();
      card.toughness = parts[1]?.trim();
    }
    console.log(`🔄 Carta ${card.name} transformada a la cara index ${faceIndex}.`);
  }

  // --- SPRINT 14: COMBAT & STATE EVALUATORS ---

  public evaluateAttackTriggers(state: GameState): void {
    const p = state.player1.id === state.activePlayerId ? state.player1 : state.player2;
    const attackers = p.field.filter(c => c.isAttacking);
    if (attackers.length === 0) return;

    // 1. Pack Tactics (Tácticas de Manada)
    const totalPower = attackers.reduce((acc, card) => acc + this.getModifiedPower(card, p), 0);
    const hasPackTactics = attackers.some(c => this.hasAbility(c, 'pack tactics') || this.hasAbility(c, 'tácticas de manada'));
    if (totalPower >= 6 && hasPackTactics) {
      attackers.filter(c => this.hasAbility(c, 'pack tactics') || this.hasAbility(c, 'tácticas de manada')).forEach(card => {
        card.counters = card.counters || {};
        card.counters['+1/+1'] = (card.counters['+1/+1'] || 0) + 1;
        this.notificationService.showToast('Pack Tactics', `${card.name} activó Tácticas de Manada.`, 'SUCCESS');
      });
    }

    // 2. Training (Entrenamiento)
    const maxPower = Math.max(...attackers.map(c => this.getModifiedPower(c, p)));
    attackers.filter(c => this.hasAbility(c, 'training') || this.hasAbility(c, 'entrenamiento')).forEach(card => {
      if (this.getModifiedPower(card, p) < maxPower) {
        card.counters = card.counters || {};
        card.counters['+1/+1'] = (card.counters['+1/+1'] || 0) + 1;
        this.notificationService.showToast('Entrenamiento', `${card.name} ha entrenado y recibe +1/+1.`, 'SUCCESS');
      }
    });
  }

  public activateBoast(cardId: string): void {
    const state = this.gameStateSubject.value;
    const p = this.me();
    if (!state || !p) return;

    const card = p.field.find(c => c.id === cardId);
    if (!card) return;

    if (!card.hasAttackedThisTurn) {
      this.notificationService.showToast('Alardear', 'Solo puedes alardear si la criatura atacó este turno.', 'WARNING');
      return;
    }

    if (card.boastActivatedThisTurn) {
      this.notificationService.showToast('Alardear', 'Solo puedes alardear una vez por turno.', 'WARNING');
      return;
    }

    card.boastActivatedThisTurn = true;

    // Trigger effect
    const stackItem: StackItem = {
      id: Math.random().toString(36).substr(2, 9),
      sourceCardId: card.id,
      controllerId: p.id,
      type: 'ABILITY',
      name: `Alardear: ${card.name}`,
      card: { ...card },
      imageUrl: card.imageUrl,
      effect: this.parseCardEffect(card),
      kicked: false
    };
    state.stack.push(stackItem);
    this.updateState({ passedCount: 0 });
    this.notificationService.showToast('Alardear', `${card.name} alardeó con éxito.`, 'SUCCESS');
  }

  public checkDelirium(player: PlayerGameState): boolean {
    const types = new Set<string>();
    player.graveyard.forEach(card => {
      const parts = (card.type || '').split('—')[0].split(' ');
      parts.forEach(p => {
        if (p.trim() && !['Legendary', 'Basic', 'Snow', 'Tribal'].includes(p.trim())) {
          types.add(p.trim().toLowerCase());
        }
      });
    });
    return types.size >= 4;
  }

  public checkThreshold(player: PlayerGameState): boolean {
    return player.graveyard.length >= 7;
  }

  public checkHellbent(player: PlayerGameState): boolean {
    return player.hand.length === 0;
  }
}
