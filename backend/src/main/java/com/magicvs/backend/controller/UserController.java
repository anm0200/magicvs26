package com.magicvs.backend.controller;

import com.magicvs.backend.model.User;
import com.magicvs.backend.service.RegistroService;
import com.magicvs.backend.service.LoginService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
@CrossOrigin(origins = "http://localhost:4200")
@RequestMapping("/api/users")
public class UserController {

    private final RegistroService registroService;
    private final LoginService loginService;

    public UserController(RegistroService registroService, LoginService loginService) {
        this.registroService = registroService;
        this.loginService = loginService;
    }

    // ---- Endpoints expuestos para Registro y Login ----

    @PostMapping("/register")
    public ResponseEntity<UserResponse> register(@RequestBody RegistroRequest request) {
        try {
            User user = registroService.registrar(request.username, request.email, request.password, request.displayName);
            return ResponseEntity.status(HttpStatus.CREATED).body(UserResponse.fromEntity(user));
        } catch (IllegalArgumentException ex) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, ex.getMessage());
        }
    }

    @PostMapping("/login")
    public ResponseEntity<UserResponse> login(@RequestBody LoginRequest request) {
        try {
            User user = loginService.login(request.usernameOrEmail, request.password);
            return ResponseEntity.ok(UserResponse.fromEntity(user));
        } catch (IllegalArgumentException ex) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, ex.getMessage());
        }
    }

    // ---- DTOs para las peticiones y respuestas ----

    public static class RegistroRequest {
        public String username;
        public String email;
        public String password;
        public String displayName;
    }

    public static class LoginRequest {
        public String usernameOrEmail;
        public String password;
    }

    public static class UserResponse {
        public Long id;
        public String username;
        public String email;
        public String displayName;
        public String friendTag;
        public Integer eloRating;
        public Integer friendsCount;

        public static UserResponse fromEntity(User user) {
            UserResponse resp = new UserResponse();
            resp.id = user.getId();
            resp.username = user.getUsername();
            resp.email = user.getEmail();
            resp.displayName = user.getDisplayName();
            resp.friendTag = user.getFriendTag();
            resp.eloRating = user.getEloRating();
            resp.friendsCount = user.getFriendsCount();
            return resp;
        }
    }
}
