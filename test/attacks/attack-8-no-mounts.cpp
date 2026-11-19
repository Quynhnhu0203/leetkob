#include <iostream>
#include <sys/stat.h>

// Attack 8: Attempt to access host Docker socket or sensitive mounts
int main() {
    struct stat st;
    if (stat("/var/run/docker.sock", &st) == 0 || stat("/run/docker.sock", &st) == 0) {
        std::cout << "BREACH: docker socket accessible!\n";
        return 42;
    }
    if (stat("/host", &st) == 0 || stat("/root", &st) == 0) {
        std::cout << "BREACH: host filesystem mount found!\n";
        return 43;
    }
    std::cerr << "docker socket and host mounts blocked\n";
    return 1;
}

