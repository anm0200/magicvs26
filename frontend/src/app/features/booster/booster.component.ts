import { Component, inject, ChangeDetectorRef, ViewChild, ElementRef, AfterViewInit, OnDestroy, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { BoosterService } from '../../core/services/booster.service';
import { CardSummary } from '../../models/user-card.model';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

@Component({
  selector: 'app-booster',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './booster.component.html',
  styleUrls: ['./booster.component.scss']
})
export class BoosterComponent implements AfterViewInit, OnDestroy {
  @ViewChild('canvasContainer') canvasContainer!: ElementRef<HTMLDivElement>;

  private boosterService = inject(BoosterService);
  private cdr = inject(ChangeDetectorRef);
  
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private model: THREE.Group | null = null;
  private animationFrameId: number | null = null;
  private targetRotationX = 0;
  private targetRotationY = 0;
  private idleRotationX = 0;
  private idleRotationY = -Math.PI / 2; // 90 degrees counter-clockwise on Y
  private shakeOffset = 0;
  
  modelLoading = true;
  modelError = false;
  
  openedCards: CardSummary[] = [];
  isOpening = false;
  error: string | null = null;
  
  // Interaction state
  isDragging = false;
  startX = 0;
  startY = 0;
  baseRotateX = 0;
  baseRotateY = 0;
  hasDragged = false;
  
  // Click state
  clickCount = 0;
  isPackOpened = false;
  
  ngAfterViewInit() {
    this.initThreeJs();
  }
  
  ngOnDestroy() {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
    }
    if (this.renderer) {
      this.renderer.dispose();
    }
  }
  
  private initThreeJs() {
    const container = this.canvasContainer.nativeElement;
    
    // Scene setup
    this.scene = new THREE.Scene();
    
    // Camera setup
    this.camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 100);
    this.camera.position.z = 5;
    
    // Renderer setup
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(this.renderer.domElement);
    
    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.5);
    this.scene.add(ambientLight);
    
    const directionalLight = new THREE.DirectionalLight(0xffffff, 2);
    directionalLight.position.set(2, 5, 5);
    this.scene.add(directionalLight);
    
    const fillLight = new THREE.DirectionalLight(0xff00aa, 1.5); // pinkish fill
    fillLight.position.set(-5, 0, 5);
    this.scene.add(fillLight);
    
    // Load Model
    const loader = new GLTFLoader();
    loader.load(
      'assets/sobre_magicvs.glb',
      (gltf: any) => {
        this.model = gltf.scene;
        
        // Center the model and adjust scale
        const box = new THREE.Box3().setFromObject(this.model!);
        const center = box.getCenter(new THREE.Vector3());
        this.model!.position.sub(center);
        
        // Save original colors for reset
        this.model!.traverse((child: any) => {
          if (child.isMesh && child.material) {
            child.material.userData = { originalColor: child.material.color.getHex() };
          }
        });
        
        // Wrap it in a group so we can rotate around the center easily
        const group = new THREE.Group();
        group.add(this.model!);
        this.model = group;
        
        // Initial rotation: 90 degrees on X axis
        this.model.rotation.x = this.idleRotationX;
        this.model.rotation.y = this.idleRotationY;
        this.targetRotationX = this.idleRotationX;
        this.targetRotationY = this.idleRotationY;
        
        // Auto scale to fit roughly
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        const scale = 3.5 / maxDim; // Fit within the camera view
        this.model.scale.set(scale, scale, scale);
        
        this.scene.add(this.model);
        this.modelLoading = false;
        this.cdr.detectChanges();
      },
      undefined,
      (error: any) => {
        console.error('Error loading 3D model:', error);
        this.modelError = true;
        this.modelLoading = false;
        this.cdr.detectChanges();
      }
    );
    
    // Animation loop
    const animate = () => {
      this.animationFrameId = requestAnimationFrame(animate);
      
      if (this.model && !this.isDragging) {
        // Smooth snap back to idle rotation
        this.targetRotationY += (this.idleRotationY - this.targetRotationY) * 0.05;
        this.targetRotationX += (this.idleRotationX - this.targetRotationX) * 0.05;
        
        this.model.rotation.y += (this.targetRotationY - this.model.rotation.y) * 0.1;
        this.model.rotation.x += (this.targetRotationX - this.model.rotation.x) * 0.1;
      } else if (this.model) {
        this.model.rotation.y += (this.targetRotationY - this.model.rotation.y) * 0.3;
        this.model.rotation.x += (this.targetRotationX - this.model.rotation.x) * 0.3;
      }
      
      // Shake effect when clicking
      if (this.shakeOffset > 0) {
        this.camera.position.x = (Math.random() - 0.5) * this.shakeOffset;
        this.camera.position.y = (Math.random() - 0.5) * this.shakeOffset;
        this.shakeOffset *= 0.8; // dampen
        if (this.shakeOffset < 0.01) this.shakeOffset = 0;
      } else {
        this.camera.position.x = 0;
        this.camera.position.y = 0;
      }
      
      this.renderer.render(this.scene, this.camera);
    };
    
    animate();
  }
  
  @HostListener('window:resize')
  onWindowResize() {
    if (this.camera && this.renderer && this.canvasContainer) {
      const container = this.canvasContainer.nativeElement;
      this.camera.aspect = container.clientWidth / container.clientHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(container.clientWidth, container.clientHeight);
    }
  }

  onStartDrag(event: MouseEvent | TouchEvent) {
    if (this.isPackOpened || this.isOpening || this.modelLoading) return;
    this.isDragging = true;
    this.hasDragged = false;
    this.startX = this.getClientX(event);
    this.startY = this.getClientY(event);
    this.baseRotateX = this.targetRotationX;
    this.baseRotateY = this.targetRotationY;
  }

  onDrag(event: MouseEvent | TouchEvent) {
    if (!this.isDragging || this.isPackOpened || this.isOpening || !this.model) return;
    
    const currentX = this.getClientX(event);
    const currentY = this.getClientY(event);
    const deltaX = currentX - this.startX;
    const deltaY = currentY - this.startY;
    
    if (Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5) {
      this.hasDragged = true;
    }
    
    // Calculate rotation. Limiting max angles.
    // ThreeJS uses radians
    let newRotY = this.baseRotateY + (deltaX * 0.01);
    let newRotX = this.baseRotateX + (deltaY * 0.01);
    
    // Clamp values relative to idle rotation (+/- Math.PI rad for full 180deg turn each way)
    this.targetRotationY = Math.max(this.idleRotationY - Math.PI, Math.min(this.idleRotationY + Math.PI, newRotY));
    this.targetRotationX = Math.max(this.idleRotationX - Math.PI, Math.min(this.idleRotationX + Math.PI, newRotX));
  }

  onEndDrag() {
    if (this.isDragging) {
      this.isDragging = false;
      
      if (!this.hasDragged && !this.isPackOpened && !this.isOpening) {
        this.handlePackClick();
      }
      
      
      // Target rotates back to idle
      this.targetRotationX = this.idleRotationX;
      this.targetRotationY = this.idleRotationY;
    }
  }

  private handlePackClick() {
    this.clickCount++;
    
    if (this.clickCount >= 3) {
      this.shakeOffset = 0.5; // Final big shake
      this.openPackAction();
    } else {
      // Trigger a shake animation
      this.shakeOffset = 0.2 * this.clickCount;
      
      // Optionally tint the model darker/redder
      if (this.model) {
        this.model.traverse((child: any) => {
          if (child.isMesh && child.material) {
            const color = child.material.color.getHex();
            if (this.clickCount === 1) child.material.color.setHex(0xffdddd);
            if (this.clickCount === 2) child.material.color.setHex(0xffaaaa);
          }
        });
      }
    }
  }

  private getClientX(event: MouseEvent | TouchEvent): number {
    return event instanceof MouseEvent ? event.clientX : event.touches[0].clientX;
  }
  
  private getClientY(event: MouseEvent | TouchEvent): number {
    return event instanceof MouseEvent ? event.clientY : event.touches[0].clientY;
  }
  
  openPackAction() {
    this.isPackOpened = true;
    this.openBooster();
  }

  openBooster() {
    this.isOpening = true;
    this.error = null;
    this.openedCards = [];
    
    this.boosterService.openBooster().subscribe({
      next: (cards) => {
        this.cdr.detectChanges();
        setTimeout(() => {
          this.openedCards = cards;
          this.isOpening = false;
          this.cdr.detectChanges();
        }, 1500); // Wait for the pack opening animation
      },
      error: (err) => {
        console.error('Error opening booster', err);
        this.error = 'Hubo un error al abrir el sobre. Inténtalo de nuevo.';
        this.isOpening = false;
        this.isPackOpened = false;
        this.clickCount = 0;
      }
    });
  }

  resetPack() {
    this.openedCards = [];
    this.isPackOpened = false;
    this.clickCount = 0;
    this.shakeOffset = 0;
    this.targetRotationX = this.idleRotationX;
    this.targetRotationY = this.idleRotationY;
    
    // Reset colors
    if (this.model) {
      this.model.traverse((child: any) => {
        if (child.isMesh && child.material && child.material.userData?.originalColor !== undefined) {
          child.material.color.setHex(child.material.userData.originalColor);
        }
      });
    }
  }

  getRarityClass(rarity: string): string {
    switch (rarity.toLowerCase()) {
      case 'mythic': return 'text-orange-500 font-bold';
      case 'rare': return 'text-yellow-400 font-bold';
      case 'uncommon': return 'text-slate-300 font-semibold';
      case 'common': return 'text-white';
      default: return 'text-gray-400';
    }
  }

  translateRarity(rarity: string): string {
    const map: Record<string, string> = {
      'common': 'Común',
      'uncommon': 'Infrecuente',
      'rare': 'Rara',
      'mythic': 'Mítica',
      'special': 'Especial',
      'bonus': 'Bonus'
    };
    return map[(rarity || '').toLowerCase()] || rarity;
  }
}
