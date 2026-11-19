#include <iostream>
#include <cstdlib>
#include <fstream>
#include <string>

// Attack 9: Attempt to read secrets from environment or procfs
int main() {
    const char* k1 = std::getenv("GEMINI_API_KEY");
    const char* k2 = std::getenv("MODEL_API_KEY");
    const char* k3 = std::getenv("API_KEY");
    if (k1 != nullptr || k2 != nullptr || k3 != nullptr) {
        std::cout << "BREACH: model API key present in env!\n";
        return 42;
    }
    std::ifstream env("/proc/1/environ");
    std::string line;
    while (std::getline(env, line)) {
        if (line.find("API_KEY") != std::string::npos || line.find("AIza") != std::string::npos) {
            std::cout << "BREACH: model API key found in /proc/1/environ!\n";
            return 43;
        }
    }
    std::cerr << "no secrets accessible in container\n";
    return 1;
}

