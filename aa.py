import os

# Define the project root directory and output file
project_root = r"C:\Users\hanos\cb\backend"
output_file = os.path.join(project_root, "stripe_migration_report.txt")

# List of files to collect (relative to project_root)
files_to_collect = [
    ".env",
    "package.json",
    "server.js",
    "controllers/auth.js",
    "controllers/cards.js",
    "controllers/payments.js",
    "controllers/subscriptions.js",
    "controllers/users.js",
    "lib/prismaClient.js",
    "middleware/requireAuth.js",
    "prisma/schema.prisma"
]

print("🔍 Starting file collection...")
with open(output_file, "w", encoding="utf-8") as outfile:
    outfile.write("=== Stripe Migration Report ===\n\n")
    for relative_path in files_to_collect:
        full_path = os.path.join(project_root, relative_path)
        if os.path.exists(full_path):
            outfile.write(f"\n--- {relative_path} ---\n\n")
            try:
                with open(full_path, "r", encoding="utf-8") as infile:
                    content = infile.read()
                    outfile.write(content)
            except Exception as e:
                outfile.write(f"[ERROR READING FILE]: {e}\n")
            outfile.write("\n")
            print(f"✅ Added: {relative_path}")
        else:
            outfile.write(f"\n--- {relative_path} ---\n")
            outfile.write("[FILE NOT FOUND]\n\n")
            print(f"⚠️ Skipped (not found): {relative_path}")

print("\n🎉 File collection complete!")
print(f"   All contents saved to: {output_file}")
