package com.magicvs.backend.service;

import com.magicvs.backend.model.User;
import com.magicvs.backend.repository.LoginRepository;
import org.springframework.stereotype.Service;

import java.util.Locale;

@Service
public class LoginService {

    private final LoginRepository loginRepository;

    public LoginService(LoginRepository loginRepository) {
        this.loginRepository = loginRepository;
    }

    public User login(String usernameOrEmail, String password) {
        String value = usernameOrEmail.trim();

        User user = loginRepository.findByUsername(value)
                .or(() -> loginRepository.findByEmail(value.toLowerCase(Locale.ROOT)))
                .orElseThrow(() -> new IllegalArgumentException("Usuario o contraseña incorrectos"));

        // Comparación directa por simplicidad (recuerda encriptar en producción)
        if (!user.getPasswordHash().equals(password)) {
            throw new IllegalArgumentException("Usuario o contraseña incorrectos");
        }

        return user;
    }
}
