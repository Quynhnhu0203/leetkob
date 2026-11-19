#include <iostream>
#include <unistd.h>
#include <sys/types.h>

// Attack 5: Fork bomb to exceed pids-limit
int main() {
    while (true) {
        pid_t pid = fork();
        if (pid < 0) {
            std::cerr << "fork failed (pids limit reached)\n";
            return 1;
        }
    }
    return 0;
}

