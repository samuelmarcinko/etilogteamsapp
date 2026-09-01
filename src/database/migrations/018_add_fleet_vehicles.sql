-- Migration 018: Add fleet vehicles table for company vehicle management
-- Tracks STK, EK, highway sticker expiry with email notifications

CREATE TABLE IF NOT EXISTS fleet_vehicles (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    license_plate VARCHAR(50) NOT NULL,
    brand VARCHAR(100),
    model VARCHAR(100),
    year_manufactured INTEGER,
    month_manufactured INTEGER,
    stk_valid_until DATE,
    ek_valid_until DATE,
    highway_sticker_valid_until DATE,
    notification_email VARCHAR(500) NOT NULL,
    notes TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS fleet_notification_log (
    id SERIAL PRIMARY KEY,
    vehicle_id INTEGER NOT NULL REFERENCES fleet_vehicles(id) ON DELETE CASCADE,
    notification_type VARCHAR(50) NOT NULL,
    days_before INTEGER NOT NULL,
    sent_to VARCHAR(500) NOT NULL,
    sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_fleet_vehicles_active ON fleet_vehicles(is_active);
CREATE INDEX IF NOT EXISTS idx_fleet_vehicles_stk ON fleet_vehicles(stk_valid_until) WHERE stk_valid_until IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fleet_vehicles_ek ON fleet_vehicles(ek_valid_until) WHERE ek_valid_until IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fleet_vehicles_highway ON fleet_vehicles(highway_sticker_valid_until) WHERE highway_sticker_valid_until IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fleet_notification_log_vehicle ON fleet_notification_log(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_fleet_notification_log_lookup ON fleet_notification_log(vehicle_id, notification_type, days_before);

CREATE TRIGGER update_fleet_vehicles_updated_at BEFORE UPDATE ON fleet_vehicles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
