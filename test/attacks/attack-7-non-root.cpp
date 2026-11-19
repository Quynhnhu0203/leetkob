#include <iostream>
#include <unistd.h>
#include <fstream>

// Attack 7: Attempt root privilege operations
int main() {
    uid_t uid = getuid();
    uid_t euid = geteuid();
    if (uid == 0 || euid == 0) {
        std::cout << "BREACH: running as root!\n";
        return 42;
    }
    std::ofstream f("/etc/hacked.txt");
    if (f.is_open()) {
        std::cout << "BREACH: wrote to /etc!\n";
        return 43;
    }
    std::cerr << "running as non-root user (uid=" << uid << ")\n";
    return 1;
}

