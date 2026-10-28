# init_db.py - Initialize the database with schema and sample data

import mysql.connector
import bcrypt
import sys
from config import DB_HOST, DB_USER, DB_PASSWORD, DB_NAME

def create_database():
    """Create the election_db database if it doesn't exist."""
    try:
        conn = mysql.connector.connect(
            host=DB_HOST,
            user=DB_USER,
            password=DB_PASSWORD
        )
        cursor = conn.cursor()
        cursor.execute(f"CREATE DATABASE IF NOT EXISTS {DB_NAME}")
        cursor.close()
        conn.close()
        print(f"[INIT] Database '{DB_NAME}' ready.")
    except mysql.connector.Error as e:
        print(f"[INIT ERROR] Cannot connect to MySQL: {e}")
        print("Make sure MySQL is running and credentials are correct in config.py")
        sys.exit(1)


def run_schema():
    """Create all tables in the database."""
    conn = mysql.connector.connect(
        host=DB_HOST,
        user=DB_USER,
        password=DB_PASSWORD,
        database=DB_NAME
    )
    cursor = conn.cursor()

    # Read and execute schema SQL
    with open('sql/schema.sql', 'r') as f:
        schema_sql = f.read()

    # Split and execute each statement
    statements = [s.strip() for s in schema_sql.split(';') if s.strip()]
    for statement in statements:
        try:
            cursor.execute(statement)
        except mysql.connector.Error as e:
            print(f"[SCHEMA] Skipping: {e}")

    conn.commit()
    cursor.close()
    conn.close()
    print("[INIT] Tables created successfully.")


def seed_data():
    """Insert sample candidates and admin user."""
    conn = mysql.connector.connect(
        host=DB_HOST,
        user=DB_USER,
        password=DB_PASSWORD,
        database=DB_NAME
    )
    cursor = conn.cursor()

    # Insert candidates
    candidates = [
        (1, 'Alice Johnson', 'Party A', 0),
        (2, 'Bob Smith', 'Party B', 0),
        (3, 'Charlie Brown', 'Party C', 0),
    ]

    for candidate in candidates:
        try:
            cursor.execute("""
                INSERT INTO candidates (id, name, party, votes)
                VALUES (%s, %s, %s, %s)
                ON DUPLICATE KEY UPDATE name=VALUES(name), party=VALUES(party)
            """, candidate)
        except mysql.connector.Error as e:
            print(f"[SEED] Candidate skip: {e}")

    # Insert admin user
    admin_password = bcrypt.hashpw("admin123".encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
    try:
        cursor.execute("""
            INSERT INTO admins (username, password_hash)
            VALUES (%s, %s)
            ON DUPLICATE KEY UPDATE password_hash=VALUES(password_hash)
        """, ('admin', admin_password))
    except mysql.connector.Error as e:
        print(f"[SEED] Admin skip: {e}")

    conn.commit()
    cursor.close()
    conn.close()
    print("[INIT] Sample data inserted (3 candidates + admin).")


def create_genesis_block():
    """Initialize the blockchain with the genesis block."""
    import sys
    sys.path.insert(0, '.')
    from blockchain import create_genesis_block as make_genesis
    make_genesis()
    print("[INIT] Genesis block created in blockchain.")


if __name__ == '__main__':
    print("\n" + "="*50)
    print("  Initializing Election Portal Database...")
    print("="*50 + "\n")

    create_database()
    run_schema()
    seed_data()
    create_genesis_block()

    print("\n" + "="*50)
    print("  Setup Complete!")
    print("  Run: python app.py")
    print("  Admin: username=admin, password=admin123")
    print("="*50 + "\n")
