package com.magicvs.backend.service;

import com.magicvs.backend.repository.LoginRepository;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.security.SecureRandom;
import java.time.Duration;
import java.time.LocalDateTime;
import java.util.Base64;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class AuthService {

    private static final String SESSION_KEY_PREFIX = "magicvs:sessions:";
    private static final Duration SESSION_TTL = Duration.ofDays(7);
    private final Map<String, Long> sessions = new ConcurrentHashMap<>();
    private static final SecureRandom RANDOM = new SecureRandom();

    private final LoginRepository loginRepository;
    private final StringRedisTemplate redisTemplate;

    public AuthService(LoginRepository loginRepository, StringRedisTemplate redisTemplate) {
        this.loginRepository = loginRepository;
        this.redisTemplate = redisTemplate;
    }

    @EventListener(ApplicationReadyEvent.class)
    @Transactional
    public void resetOnlineStatusOnStartup() {
        loginRepository.resetAllOnlineStatus();
    }

    @Transactional
    public String createSession(Long userId) {
        byte[] bytes = new byte[24];
        RANDOM.nextBytes(bytes);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        sessions.put(token, userId);
        redisTemplate.opsForValue().set(sessionKey(token), userId.toString(), SESSION_TTL);
        loginRepository.findById(userId).ifPresent(user -> {
            user.setIsOnline(true);
            user.setLastSeenAt(LocalDateTime.now());
            loginRepository.save(user);
        });
        return token;
    }

    public Optional<Long> getUserId(String token) {
        if (token == null) return Optional.empty();
        Long localUserId = sessions.get(token);
        if (localUserId != null) {
            redisTemplate.expire(sessionKey(token), SESSION_TTL);
            return Optional.of(localUserId);
        }

        String userId = redisTemplate.opsForValue().get(sessionKey(token));
        if (userId == null) {
            return Optional.empty();
        }

        try {
            Long parsedUserId = Long.valueOf(userId);
            sessions.put(token, parsedUserId);
            redisTemplate.expire(sessionKey(token), SESSION_TTL);
            return Optional.of(parsedUserId);
        } catch (NumberFormatException e) {
            redisTemplate.delete(sessionKey(token));
            return Optional.empty();
        }
    }

    @Transactional
    public void logout(String token) {
        Long userId = sessions.remove(token);
        redisTemplate.delete(sessionKey(token));
        if (userId != null) {
            loginRepository.findById(userId).ifPresent(user -> {
                user.setIsOnline(false);
                user.setLastSeenAt(LocalDateTime.now());
                loginRepository.save(user);
            });
        }
    }

    public void invalidate(String token) {
        sessions.remove(token);
        redisTemplate.delete(sessionKey(token));
    }

    private String sessionKey(String token) {
        return SESSION_KEY_PREFIX + token;
    }
}
