import os
import time

# Use the 'r' prefix for raw strings to avoid backslash escape errors
target_file_path = r"C:\Users\Thash\Desktop\Test folder\Screen Recording 2026-04-12 200536.mp4"

days_in_past = 200
past_time = time.time() - (days_in_past * 86400)

try:
    os.utime(target_file_path, (past_time, past_time))
    print(f"Successfully backdated '{target_file_path}' by {days_in_past} days!")
    print(f"Simulated Last Accessed: {time.ctime(past_time)}")
except FileNotFoundError:
    print(f"Error: Could not find the file at '{target_file_path}'. Please check the path!")