from dotenv import load_dotenv; load_dotenv()
import database as db

# Fix Person 1 -> Vaibhav Yadav
db.execute_query(
    'UPDATE users SET name=?, email=? WHERE id=1',
    ('Vaibhav Yadav', 'vaibhavyadav9952@gmail.com')
)
print('Updated user_id=1 -> Vaibhav Yadav')

users = db.get_all_users()
print(f'\nTotal users in DB: {len(users)}')
print(f'{"ID":<5} {"Name":<20} {"Email":<35} {"Voted":<6}')
print('-' * 70)
for u in users:
    print(f'{u["id"]:<5} {u["name"]:<20} {u["email"]:<35} {u["has_voted"]}')
