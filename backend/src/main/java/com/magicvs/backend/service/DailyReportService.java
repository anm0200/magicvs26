package com.magicvs.backend.service;

import com.magicvs.backend.model.User;
import com.magicvs.backend.model.UserDailyStats;
import com.magicvs.backend.model.Match;
import com.magicvs.backend.model.UserAchievement;
import com.magicvs.backend.model.News;
import com.magicvs.backend.repository.RegistroRepository;
import com.magicvs.backend.repository.UserDailyStatsRepository;
import com.magicvs.backend.repository.MatchRepository;
import com.magicvs.backend.repository.UserAchievementRepository;
import com.magicvs.backend.repository.NewsRepository;
import jakarta.mail.internet.MimeMessage;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.io.ClassPathResource;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;

import java.time.LocalDateTime;
import java.util.List;

@Service
public class DailyReportService {

    private static final Logger logger = LoggerFactory.getLogger(DailyReportService.class);

    private final UserDailyStatsRepository dailyStatsRepository;
    private final RegistroRepository userRepository;
    private final JavaMailSender mailSender;
    private final MatchRepository matchRepository;
    private final UserAchievementRepository userAchievementRepository;
    private final NewsRepository newsRepository;

    public DailyReportService(UserDailyStatsRepository dailyStatsRepository,
                              RegistroRepository userRepository,
                              JavaMailSender mailSender,
                              MatchRepository matchRepository,
                              UserAchievementRepository userAchievementRepository,
                              NewsRepository newsRepository) {
        this.dailyStatsRepository = dailyStatsRepository;
        this.userRepository = userRepository;
        this.mailSender = mailSender;
        this.matchRepository = matchRepository;
        this.userAchievementRepository = userAchievementRepository;
        this.newsRepository = newsRepository;
    }

    // Se ejecuta según la configuración en application.properties (por defecto 8:00 AM)
    @Scheduled(cron = "${app.daily-report.cron}")
    public void sendDailyReports() {
        LocalDateTime end = LocalDateTime.now();
        LocalDateTime start = end.minusDays(1);
        logger.info("Iniciando envío de reportes diarios para la ventana deslizable: {} a {}", start, end);

        // Obtener el Top 3 global de la Arena
        List<User> topUsers = userRepository.findTopByElo(PageRequest.of(0, 3));

        // Obtener las últimas 2 noticias de la base de datos
        List<News> latestNews = newsRepository.findAll(PageRequest.of(0, 2, Sort.by(Sort.Direction.DESC, "publishDate"))).getContent();

        List<User> allUsers = userRepository.findAll();
        for (User user : allUsers) {
            if (Boolean.TRUE.equals(user.getActive())) {
                try {
                    // Consultar partidas jugadas en las últimas 24 horas
                    List<Match> matches = matchRepository.findFinishedByUserInDateRange(user, start, end);
                    int played = matches.size();
                    int won = 0;
                    int eloBefore = user.getEloRating();
                    int eloAfter = user.getEloRating();
                    
                    if (played > 0) {
                        int netEloChange = 0;
                        for (Match m : matches) {
                            boolean isWinner = user.getId().equals(m.getWinnerId());
                            if (isWinner) {
                                won++;
                            }
                            int change = m.getEloChange() != null ? m.getEloChange() : 0;
                            if (isWinner) {
                                netEloChange += change;
                            } else {
                                netEloChange -= change;
                            }
                        }
                        eloBefore = eloAfter - netEloChange;
                    }
                    
                    // Consultar logros ganados en las últimas 24 horas
                    List<UserAchievement> earnedAchievements = userAchievementRepository.findEarnedByUserInDateRange(user, start, end);
                    
                    sendEmail(user, played, won, eloBefore, eloAfter, earnedAchievements, topUsers, latestNews);
                } catch (Exception ex) {
                    logger.error("Error procesando reporte diario para usuario {}", user.getEmail(), ex);
                }
            }
        }
    }

    private void sendEmail(User user, int played, int won, int eloBefore, int eloAfter, 
                           List<UserAchievement> achievements, List<User> topUsers, List<News> latestNews) {
        try {
            String fromAddress = System.getenv("SMTP_FROM") != null ? System.getenv("SMTP_FROM")
                    : "noreply@magicvs.local";
            MimeMessage mimeMessage = mailSender.createMimeMessage();
            MimeMessageHelper helper = new MimeMessageHelper(mimeMessage, true, "UTF-8");

            helper.setTo(user.getEmail());
            helper.setFrom(fromAddress);
            helper.setSubject("📊 Tu resumen diario en MagicVS");

            String title;
            String message;
            String accentColor;
            String buttonText = "¡Jugar ahora!";

            if (played == 0) {
                title = "¡Te echamos de menos!";
                message = "En las últimas 24 horas no vimos actividad en tu cuenta. La arena se siente vacía sin ti. ¿Qué tal si echas una partida hoy?";
                accentColor = "#a1a1aa"; // Gris
            } else {
                double winRate = (double) won / played;
                if (winRate > 0.5) {
                    title = "¡Estás imparable!";
                    message = "En las últimas 24 horas dominaste el campo de batalla con un impresionante desempeño. ¡Sigue así, campeón!";
                    accentColor = "#ecb2ff"; // Lila brillante
                } else {
                    title = "¡Buen intento!";
                    message = "Las últimas 24 horas fueron de aprendizaje. Cada derrota es un paso más hacia la maestría. ¡Hoy es un buen día para la revancha!";
                    accentColor = "#ffb2b2"; // Rojo suave
                }
            }

            // HTML Header & Styling
            StringBuilder html = new StringBuilder();
            html.append("<!DOCTYPE html><html><head>")
                .append("<meta charset='UTF-8'><meta name='viewport' content='width=device-width, initial-scale=1.0'>")
                .append("<link href='https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;800;900&display=swap' rel='stylesheet'>")
                .append("<style>")
                .append("  body { background-color: #050505; color: #e4e4e7; font-family: 'Poppins', sans-serif; margin: 0; padding: 0; -webkit-font-smoothing: antialiased; }")
                .append("  .card { background-color: #0b0b0d; border: 1px solid #27272a; border-radius: 20px; padding: 40px 30px; text-align: center; }")
                .append("  .section-title { color: #ffffff; font-size: 16px; font-weight: 800; letter-spacing: 2px; text-transform: uppercase; margin: 30px 0 15px 0; text-align: left; border-bottom: 1px solid #27272a; padding-bottom: 8px; }")
                .append("  .stats-box { background-color: #121215; border-radius: 14px; padding: 20px; margin: 20px 0; border: 1px solid #1f1f23; }")
                .append("  .stat-val { font-size: 28px; font-weight: 900; color: ").append(accentColor).append("; }")
                .append("  .stat-label { font-size: 11px; color: #71717a; text-transform: uppercase; letter-spacing: 1.5px; margin-top: 4px; }")
                .append("  .elo-container { background-color: #121215; border-radius: 14px; padding: 20px; margin: 20px 0; border: 1px solid #1f1f23; text-align: center; }")
                .append("  .elo-flow { font-size: 24px; font-weight: 800; color: #ffffff; margin: 10px 0; letter-spacing: 1px; }")
                .append("  .badge-gain { background-color: rgba(34, 197, 94, 0.12); color: #4ade80; border: 1px solid rgba(34, 197, 94, 0.25); padding: 4px 12px; border-radius: 12px; font-weight: 800; font-size: 13px; display: inline-block; }")
                .append("  .badge-loss { background-color: rgba(239, 68, 68, 0.12); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.25); padding: 4px 12px; border-radius: 12px; font-weight: 800; font-size: 13px; display: inline-block; }")
                .append("  .badge-stable { background-color: rgba(161, 161, 170, 0.12); color: #a1a1aa; border: 1px solid rgba(161, 161, 170, 0.25); padding: 4px 12px; border-radius: 12px; font-weight: 800; font-size: 13px; display: inline-block; }")
                .append("  .achievement-card { border-radius: 12px; padding: 15px; margin-bottom: 12px; border: 1px solid; text-align: left; }")
                .append("  .achievement-title { font-weight: 800; font-size: 14px; color: #ffffff; }")
                .append("  .achievement-desc { font-size: 12px; color: #a1a1aa; margin-top: 4px; }")
                .append("  .achievement-pts { font-weight: 800; font-size: 13px; color: #f59e0b; }")
                .append("  .leaderboard-row { background-color: #121215; border-radius: 10px; padding: 12px 15px; margin-bottom: 8px; border: 1px solid #1f1f23; text-align: left; }")
                .append("  .leaderboard-rank { font-weight: 900; color: ").append(accentColor).append("; font-size: 14px; margin-right: 10px; }")
                .append("  .news-card { background-color: #121215; border-radius: 12px; padding: 18px; margin-bottom: 12px; border: 1px solid #1f1f23; text-align: left; }")
                .append("  .news-title { font-weight: 800; font-size: 14px; color: #ffffff; text-decoration: none; }")
                .append("  .news-summary { font-size: 12px; color: #71717a; margin-top: 6px; line-height: 1.5; }")
                .append("</style></head><body>");

            html.append("<table width='100%' border='0' cellspacing='0' cellpadding='0' style='background-color: #000000; padding: 40px 10px;'>")
                .append("  <tr><td align='center'>")
                .append("    <table width='100%' style='max-width: 600px;' border='0' cellspacing='0' cellpadding='0'>")
                .append("      <tr><td style='padding-bottom: 30px; text-align: left;'>")
                .append("        <span style='color: #ffffff; font-size: 20px; font-weight: 900; letter-spacing: 6px;'>MAGICVS</span>")
                .append("      </td></tr>")
                .append("      <tr><td>")
                .append("        <div class='card'>")
                .append("          <div style='text-align: center; margin-bottom: 25px;'><img src='cid:logo' width='180' alt='MagicVS Logo'></div>")
                .append("          <h2 style='color: #ffffff; font-size: 28px; margin: 0 0 15px 0; font-weight: 800;'>").append(title).append("</h2>")
                .append("          <p style='color: #a1a1aa; font-size: 15px; line-height: 1.6; margin-bottom: 30px;'>").append(message).append("</p>");

            // 1. ELO Rating Evolution Section
            html.append("          <div class='elo-container'>")
                .append("            <div class='stat-label'>Rango ELO</div>");
            if (played > 0) {
                int eloChange = eloAfter - eloBefore;
                html.append("            <div class='elo-flow'>").append(eloBefore).append(" ➔ ").append(eloAfter).append("</div>");
                if (eloChange > 0) {
                    html.append("            <div><span class='badge-gain'>+").append(eloChange).append(" ELO</span></div>");
                } else if (eloChange < 0) {
                    html.append("            <div><span class='badge-loss'>").append(eloChange).append(" ELO</span></div>");
                } else {
                    html.append("            <div><span class='badge-stable'>Sin cambios</span></div>");
                }
            } else {
                html.append("            <div class='elo-flow'>").append(eloAfter).append(" ELO</div>")
                    .append("            <div><span class='badge-stable'>Estable</span></div>")
                    .append("            <p style='font-size: 12px; color: #71717a; margin: 8px 0 0 0;'>¡Entra a combatir hoy para subir en el ranking!</p>");
            }
            html.append("          </div>");

            // 2. Played & Won stats (only if played > 0)
            if (played > 0) {
                html.append("          <div class='stats-box'>")
                    .append("            <table width='100%' border='0' cellspacing='0' cellpadding='0'><tr>")
                    .append("              <td width='50%' align='center'>")
                    .append("                <div class='stat-val'>").append(played).append("</div>")
                    .append("                <div class='stat-label'>Partidas</div>")
                    .append("              </td>")
                    .append("              <td width='50%' align='center'>")
                    .append("                <div class='stat-val'>").append(won).append("</div>")
                    .append("                <div class='stat-label'>Victorias</div>")
                    .append("              </td>")
                    .append("            </tr></table>")
                    .append("          </div>");
            }

            // 3. Earned Achievements Section (only if earned any)
            if (achievements != null && !achievements.isEmpty()) {
                html.append("          <div class='section-title'>LOGROS DESBLOQUEADOS</div>");
                for (UserAchievement ua : achievements) {
                    com.magicvs.backend.model.Achievement a = ua.getAchievement();
                    String borderCol = getRankBorderColor(a.getRango());
                    String bgCol = getRankBgColor(a.getRango());
                    String emoji = getCategoryEmoji(a.getCategory());
                    
                    html.append("          <div class='achievement-card' style='border-color: ").append(borderCol).append("; background-color: ").append(bgCol).append(";'>")
                        .append("            <table width='100%' border='0' cellspacing='0' cellpadding='0'><tr>")
                        .append("              <td style='font-size: 24px; width: 40px; text-align: center; vertical-align: middle;'>").append(emoji).append("</td>")
                        .append("              <td style='padding-left: 10px; text-align: left; vertical-align: middle;'>")
                        .append("                <div class='achievement-title'>").append(a.getName()).append(" <span style='font-size: 10px; color: ").append(borderCol).append("; text-transform: uppercase;'>• ").append(a.getRango()).append("</span></div>")
                        .append("                <div class='achievement-desc'>").append(a.getDescription()).append("</div>")
                        .append("              </td>")
                        .append("              <td align='right' style='width: 70px; vertical-align: middle;'>")
                        .append("                <span class='achievement-pts'>+").append(a.getPoints()).append(" PTS</span>")
                        .append("              </td>")
                        .append("            </tr></table>")
                        .append("          </div>");
                }
            }

            // 4. Arena Leaderboard Top 3
            if (topUsers != null && !topUsers.isEmpty()) {
                html.append("          <div class='section-title'>LÍDERES DE LA ARENA</div>");
                for (int i = 0; i < topUsers.size(); i++) {
                    User u = topUsers.get(i);
                    String trophy = switch (i) {
                        case 0 -> "🥇";
                        case 1 -> "🥈";
                        case 2 -> "🥉";
                        default -> "👑";
                    };
                    html.append("          <div class='leaderboard-row'>")
                        .append("            <table width='100%' border='0' cellspacing='0' cellpadding='0'><tr>")
                        .append("              <td style='text-align: left; font-weight: 800; color: #ffffff;'>")
                        .append("                <span class='leaderboard-rank'>").append(trophy).append("</span>")
                        .append("                ").append(u.getUsername())
                        .append("              </td>")
                        .append("              <td align='right' style='font-weight: 900; color: ").append(accentColor).append("; font-size: 13px;'>")
                        .append(u.getEloRating()).append(" ELO")
                        .append("              </td>")
                        .append("            </tr></table>")
                        .append("          </div>");
                }
            }

            // 5. Latest News Section
            if (latestNews != null && !latestNews.isEmpty()) {
                html.append("          <div class='section-title'>ÚLTIMAS NOVEDADES</div>");
                for (News n : latestNews) {
                    html.append("          <div class='news-card'>")
                        .append("            <a href='").append(n.getUrl()).append("' class='news-title' target='_blank'>").append(n.getTitle()).append(" ↗</a>")
                        .append("            <div class='news-summary'>").append(n.getSummary()).append("</div>")
                        .append("          </div>");
                }
            }

            // CTA Button
            html.append("          <div style='margin-top: 35px;'>")
                .append("            <a href='http://localhost:4200' style='display: inline-block; background-color: ").append(accentColor).append("; color: #000; padding: 16px 40px; border-radius: 12px; text-decoration: none; font-weight: 900; font-size: 13px; text-transform: uppercase; letter-spacing: 1px; box-shadow: 0 4px 15px rgba(0,0,0,0.4);'>")
                .append(buttonText).append("</a>")
                .append("          </div>")
                .append("        </div>")
                .append("      </td></tr>")
                .append("      <tr><td style='padding: 40px 0; text-align: center;'>")
                .append("        <div style='color: #52525b; font-size: 10px; text-transform: uppercase; letter-spacing: 2px;'>© 2026 MAGICVS ARCANE SYSTEMS</div>")
                .append("      </td></tr>")
                .append("    </table>")
                .append("  </td></tr>")
                .append("</table>")
                .append("</body></html>");

            helper.setText(html.toString(), true);
            helper.addInline("logo", new ClassPathResource("static/images/icono.webp"));
            mailSender.send(mimeMessage);

        } catch (Exception ex) {
            logger.error("Error enviando reporte diario a {}", user.getEmail(), ex);
        }
    }

    private String getRankBorderColor(com.magicvs.backend.model.AchievementRank rank) {
        if (rank == null) return "#a1a1aa";
        return switch (rank) {
            case BRONCE -> "#cd7f32";
            case PLATA -> "#a1a1aa";
            case ORO -> "#fbbf24";
            case PLATINO -> "#38bdf8";
            case DIAMANTE -> "#22d3ee";
        };
    }

    private String getRankBgColor(com.magicvs.backend.model.AchievementRank rank) {
        if (rank == null) return "#18181b";
        return switch (rank) {
            case BRONCE -> "#1c1511";
            case PLATA -> "#18181b";
            case ORO -> "#201b10";
            case PLATINO -> "#101c26";
            case DIAMANTE -> "#102227";
        };
    }

    private String getCategoryEmoji(com.magicvs.backend.model.AchievementCategory category) {
        if (category == null) return "🏆";
        return switch (category) {
            case MATCH -> "⚔️";
            case DECK -> "🃏";
            case SOCIAL -> "👥";
            case MILESTONE -> "🏆";
        };
    }
}
