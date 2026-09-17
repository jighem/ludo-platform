CREATE TABLE league_invitations (
 id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 league_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
 invited_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
 created_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 expires_at DATETIME(6) NOT NULL,accepted_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
 accepted_at DATETIME(6) NULL,created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 FOREIGN KEY(league_id) REFERENCES leagues(id),FOREIGN KEY(invited_user_id) REFERENCES users(id),
 FOREIGN KEY(created_by) REFERENCES users(id),FOREIGN KEY(accepted_by) REFERENCES users(id),INDEX(league_id,expires_at)
) ENGINE=InnoDB;
CREATE TABLE league_join_requests (
 league_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 status ENUM('PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'PENDING',
 created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
 PRIMARY KEY(league_id,user_id),FOREIGN KEY(league_id) REFERENCES leagues(id),FOREIGN KEY(user_id) REFERENCES users(id)
) ENGINE=InnoDB;
CREATE TABLE league_settings_versions (
 id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 league_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 version INT UNSIGNED NOT NULL,configuration JSON NOT NULL,
 created_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 UNIQUE(league_id,id),UNIQUE(league_id,version),FOREIGN KEY(league_id) REFERENCES leagues(id),FOREIGN KEY(created_by) REFERENCES users(id)
) ENGINE=InnoDB;
CREATE TABLE matches (
 id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 source ENUM('ONLINE','OFFLINE_PROTECTED','PASS_PLAY','MANUAL') NOT NULL,
 phase ENUM('LOBBY','PLAYING','COMPLETED','CANCELLED') NOT NULL,
 ruleset_version_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 state JSON NOT NULL,revision INT UNSIGNED NOT NULL DEFAULT 0,
 created_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 deadline DATETIME(6) NULL,started_at DATETIME(6) NULL,finished_at DATETIME(6) NULL,
 created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 FOREIGN KEY(ruleset_version_id) REFERENCES ruleset_versions(id),FOREIGN KEY(created_by) REFERENCES users(id),INDEX(phase,deadline)
) ENGINE=InnoDB;
CREATE TABLE match_players (
 match_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 seat TINYINT UNSIGNED NOT NULL,checked_in_at DATETIME(6) NULL,last_seen_at DATETIME(6) NULL,
 PRIMARY KEY(match_id,user_id),UNIQUE(match_id,seat),CHECK(seat<4),
 FOREIGN KEY(match_id) REFERENCES matches(id),FOREIGN KEY(user_id) REFERENCES users(id)
) ENGINE=InnoDB;
CREATE TABLE league_matches (
 league_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 match_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
 settings_version_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 PRIMARY KEY(league_id,match_id),FOREIGN KEY(league_id) REFERENCES leagues(id),FOREIGN KEY(match_id) REFERENCES matches(id),
 FOREIGN KEY(league_id,settings_version_id) REFERENCES league_settings_versions(league_id,id)
) ENGINE=InnoDB;
CREATE TABLE match_events (
 match_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 sequence INT UNSIGNED NOT NULL,event JSON NOT NULL,
 created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 PRIMARY KEY(match_id,sequence),FOREIGN KEY(match_id) REFERENCES matches(id)
) ENGINE=InnoDB;
CREATE TABLE match_commands (
 match_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 actor_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 command_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 response JSON NOT NULL,created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 PRIMARY KEY(match_id,actor_id,command_id),FOREIGN KEY(match_id) REFERENCES matches(id),FOREIGN KEY(actor_id) REFERENCES users(id)
) ENGINE=InnoDB;
CREATE TABLE match_results (
 id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 match_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 revision INT UNSIGNED NOT NULL,approval ENUM('PENDING','APPROVED','REJECTED','CANCELLED','DISPUTED','REVIEW_REQUIRED') NOT NULL,
 metrics JSON NOT NULL,notes VARCHAR(1000) NULL,created_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 change_reason VARCHAR(1000) NOT NULL,
 created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 UNIQUE(match_id,revision),FOREIGN KEY(match_id) REFERENCES matches(id),FOREIGN KEY(created_by) REFERENCES users(id)
) ENGINE=InnoDB;
CREATE TABLE result_placements (
 result_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 place TINYINT UNSIGNED NOT NULL,PRIMARY KEY(result_id,user_id),UNIQUE(result_id,place),CHECK(place BETWEEN 1 AND 4),
 FOREIGN KEY(result_id) REFERENCES match_results(id),FOREIGN KEY(user_id) REFERENCES users(id)
) ENGINE=InnoDB;
