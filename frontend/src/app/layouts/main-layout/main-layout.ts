import { Component } from '@angular/core';
import { RouterOutlet, RouterLink } from '@angular/router';
import { NgIf } from '@angular/common';

@Component({
  selector: 'app-main-layout',
  imports: [RouterOutlet, RouterLink, NgIf],
  templateUrl: './main-layout.html',
  styleUrl: './main-layout.scss',
})
export class MainLayout {
  isLoggedIn = false;

  constructor() {
    this.isLoggedIn = !!localStorage.getItem('user');
  }

  logout(): void {
    localStorage.removeItem('user');
    this.isLoggedIn = false;
  }
}
