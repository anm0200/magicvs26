import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NewsService } from '../../core/services/news.service';
import { toSignal } from '@angular/core/rxjs-interop';

@Component({
  selector: 'app-news',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './news.html',
  styleUrls: ['./news.scss']
})
export class NewsComponent {
  private newsService = inject(NewsService);

  // Convert the observable to a signal for easy use in the template
  public news = toSignal(this.newsService.getNews(), { initialValue: [] });
  public lastUpdated = toSignal(this.newsService.getLastUpdated(), { initialValue: 'Cargando...' });

  public newsletterEmail = '';
  public subscriptionStatus = '';

  public subscribe() {
    if (!this.newsletterEmail) return;
    
    this.newsService.subscribeToNewsletter(this.newsletterEmail).subscribe({
      next: (res: any) => {
        this.subscriptionStatus = res.message;
        this.newsletterEmail = '';
        
        // Clear message after 5 seconds
        setTimeout(() => {
          this.subscriptionStatus = '';
        }, 5000);
      },
      error: (err) => {
        this.subscriptionStatus = err.error?.message || 'Error al suscribirse. Inténtalo de nuevo.';
        setTimeout(() => {
          this.subscriptionStatus = '';
        }, 5000);
      }
    });
  }
}
