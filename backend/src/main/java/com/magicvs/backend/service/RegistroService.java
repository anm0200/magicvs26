package com.magicvs.backend.service;

import com.magicvs.backend.model.User;
import com.magicvs.backend.repository.RegistroRepository;
import org.springframework.stereotype.Service;

import java.security.SecureRandom;
import java.util.Locale;

@Service
public class RegistroService {

    private final RegistroRepository registroRepository;

    private static final String TAG_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    private static final SecureRandom RANDOM = new SecureRandom();

    public RegistroService(RegistroRepository registroRepository) {
        this.registroRepository = registroRepository;
    }

    public User registrar(String username, String email, String password, String displayName) {
        String normalizedUsername = username.trim();
        String normalizedEmail = email.trim().toLowerCase(Locale.ROOT);

        if (registroRepository.existsByUsername(normalizedUsername)) {
            throw new IllegalArgumentException("El nombre de usuario ya está en uso");
        }
        if (registroRepository.existsByEmail(normalizedEmail)) {
            throw new IllegalArgumentException("El email ya está en uso");
        }

        User user = new User();
        user.setUsername(normalizedUsername);
        user.setEmail(normalizedEmail);
        // En un entorno real deberías encriptar la contraseña (BCrypt, etc.)
        user.setPasswordHash(password);
        user.setDisplayName(displayName != null && !displayName.isBlank() ? displayName : normalizedUsername);

        // Generar friendTag tipo Discord (letras y números), único por usuario
        user.setFriendTag(generateFriendTag());

        return registroRepository.save(user);
    }

    private String generateFriendTag() {
        int length = 6; // por ejemplo: 6 caracteres tipo ABC123
        String tag;
        do {
            StringBuilder sb = new StringBuilder(length);
            for (int i = 0; i < length; i++) {
                int idx = RANDOM.nextInt(TAG_CHARS.length());
                sb.append(TAG_CHARS.charAt(idx));
            }
            tag = sb.toString();
        } while (registroRepository.existsByFriendTag(tag));

        return tag;
    }
}
