import { Routes } from '@angular/router';
import { MainLayout } from './layouts/main-layout/main-layout';
import { Home } from './features/home/home';
import { NewsComponent } from './features/news/news';
import { Login } from './features/login/login';
import { Registro } from './features/registro/registro';

export const routes: Routes = [
  {
    path: '',
    component: MainLayout,
    children: [
      { path: '', component: Home },
      { path: 'noticias', component: NewsComponent },
      { path: 'login', component: Login },
      { path: 'registro', component: Registro }
    ]
  }
];
